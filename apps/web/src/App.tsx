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
import { startAppHost } from "./host-assembly";
import { detectAppPlatform } from "./platform-detect";
import { createPlatformHostContext } from "./platform-context";
import { createStoreSinks } from "./store-sinks";

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
 * 2. 探测运行时平台（`platform-detect.ts`）并交给装配编排（`host-assembly.ts`）；
 * 3. 工作区变更 → 自动保存 / 轮询目标同步。
 *
 * 宿主实现按平台**动态 `import()`**（Electron / VSCode / Android 各一个懒 chunk；浏览器保持
 * 静态装配）；装配期间 UI 显示启动骨架（`hostStatus`），失败则提示并保持「无 Host」可操作。
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
    void startAppHost(
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
