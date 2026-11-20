import { useEffect, useRef } from "react";
import type { AddressTransform } from "@mamep2026/domain";
import type { CompatibilityEnv } from "@mamep2026/platform-web";
import { buildPollingTargets } from "@mamep2026/register-table";
import {
  MamepApp,
  requestProtocolResolver,
  useAppStore,
  type AppHost,
} from "@mamep2026/ui";
import { detectAppPlatform } from "./platform-detect";

const MOCK_FLAG = "mockTransport";
const COMPAT_MISS_FLAG = "compatMiss";

function isMockMode(): boolean {
  return (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get(MOCK_FLAG) === "1"
  );
}

/** dev 门控覆盖开关（沿用 ?mockTransport=1 先例）：强制把检测输入置为「无 Web Serial」，
 * 供 e2e 确定性触发浏览器兼容性提示（PRD §8.3 / §15.7）。 */
function isCompatMissMode(): boolean {
  return (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get(COMPAT_MISS_FLAG) === "1"
  );
}

/**
 * 组合根（装配重构后）。
 *
 * 本文件只做三件事：
 * 1. 计算运行模式（mock / 兼容性覆盖）与共享上下文（注册表，见 `platform-context.ts`）；
 * 2. 首帧后动态加载装配编排（`host-assembly.ts`）与共享上下文；
 * 3. 工作区变更 → 自动保存 / 轮询目标同步。
 *
 * 宿主装配链本身也在首帧后动态加载，避免 AppHost、工作区校验和平台依赖进入
 * `modulepreload`；装配期间 UI 显示启动骨架（`hostStatus`），失败则保持「无 Host」可操作。
 */
export default function App(): React.ReactNode {
  /** 活动 host（工作区变更订阅据其调用 `scheduleSave` / `updatePollingTargets`）。 */
  const hostRef = useRef<AppHost | null>(null);
  /**
   * 地址变换解析：跨 effect 共享——装配 effect 建立注册表后写入，工作区
   * 变更订阅（下方 effect）在回调触发时读取；初始 no-op 兜底（装配完成前无可轮询行）。
   */
  const resolveTransformRef = useRef<
    (transformId: string) => AddressTransform | null
  >(() => null);

  // 启动装配（一次）：探测平台 → 按平台加载宿主实现 → 编排启动（见 host-assembly.ts）。
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [
          { startAppHost },
          { createPlatformHostContext },
          { createStoreSinks },
        ] = await Promise.all([
          import("./host-assembly"),
          import("./platform-context"),
          import("./store-sinks"),
        ]);
        if (controller.signal.aborted) return;
        const serial = navigator.serial;
        // 浏览器兼容性检测输入（PRD §8.3 / §15.7）：默认真实环境；?compatMiss=1 强制缺失（dev）。
        const compatibilityEnv: CompatibilityEnv = isCompatMissMode()
          ? { serial: undefined, isSecureContext: true }
          : { serial, isSecureContext: window.isSecureContext === true };
        const context = createPlatformHostContext({
          mockTransport: isMockMode(),
          compatibilityEnv,
        });
        resolveTransformRef.current = context.resolveAddressTransform;
        const bridge = window.mamepHost;
        await startAppHost(
          {
            platform: detectAppPlatform({ bridge, globalObject: globalThis }),
            context,
            bridge,
            sinks: createStoreSinks({
              setActiveHost: (host) => {
                hostRef.current = host;
              },
            }),
          },
          controller.signal,
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        useAppStore.getState().setHostStatus("failed");
        useAppStore.getState().appendMessage({
          timestamp: Date.now(),
          level: "error",
          messageKey: "messages.hostLoadFailed",
          params: {
            detail: error instanceof Error ? error.message : String(error),
          },
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => {
      // 取消装配 / 释放宿主：abort 触发 host-assembly 的退订与 dispose（StrictMode 双挂载下
      // 保证旧 host 不再接收事件——通信日志重复投递的回归防护）。
      controller.abort();
      hostRef.current = null;
    };
  }, []);

  // 工作区变更 -> 自动保存；WP 轮询目标同步（Address Adjust 应用于轮询地址）。
  // 用 store 命令式订阅代替 React 选择器 + useEffect：行数据更新（编辑/WP 轮询）
  // 不再触发 App 与 <MamepApp/> 的级联重渲染（性能优化）；仅 workspace 引用变化时执行副作用。
  useEffect(() => {
    return useAppStore.subscribe((state, prevState) => {
      if (state.workspace === prevState.workspace) return;
      const host = hostRef.current;
      if (host === null) return;
      if (state.workspace.sheets.length === 0) return;
      host.scheduleSave(state.workspace);

      // 应用层纯函数构建轮询目标（含表级地址变换偏移与地址 0 跳过按 sheet；
      // 插件外部化：变换经插件注册表解析）。
      host.updatePollingTargets(
        buildPollingTargets(state.workspace.sheets, {
          resolveAddressTransform: resolveTransformRef.current,
          resolveProtocol: requestProtocolResolver(host),
        }),
      );
    });
  }, []);

  return <MamepApp />;
}
