import { useEffect, useMemo, useRef } from "react";
import type { RowId } from "@mamep2026/domain";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import type { CommunicationLogEvent } from "@mamep2026/communication";
import { formatBytesHex } from "@mamep2026/communication";
import type { ApplicationMessage } from "@mamep2026/logging";
import { PluginRegistry } from "@mamep2026/plugin-api";
import {
  BrowserPlatformHost,
  createIdbKeyValueStore,
  IndexedDBWorkspaceRepository,
} from "@mamep2026/platform-web";
import {
  applyPollResult,
  buildPollingTargets,
} from "@mamep2026/register-table";
import { MamepApp, useAppStore, type AppHost } from "@mamep2026/ui";
import { BrowserAppHost } from "./AppHost";
import { ElectronAppHost } from "./electron-app-host";
import { VscodeAppHost } from "./vscode-app-host";
import { IndexedDBPluginStore } from "./indexeddb-plugin-store";

const MOCK_FLAG = "mockTransport";

function isMockMode(): boolean {
  return (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get(MOCK_FLAG) === "1"
  );
}

// UI 层日志自增序号：作为 Listy 稳定 rowKey（与 logging store 的 seq 独立，各自领域内唯一）。
let nextCommLogSeq = 0;

function toCommLogEntry(event: CommunicationLogEvent) {
  return {
    seq: nextCommLogSeq++,
    timestamp: event.timestamp,
    direction: event.direction,
    bytesHex: formatBytesHex(event.bytes),
    protocol: event.protocol,
    slaveAddress: event.slaveAddress,
    functionCode: event.functionCode,
    userAddress: event.userAddress,
    sentAddress: event.sentAddress,
    quantity: event.quantity,
    attempt: event.attempt,
    status: event.status,
    errorCode: event.errorCode,
    exceptionCode: event.exceptionCode,
    source: event.source,
    durationMs: event.durationMs,
  };
}

function registerExamplePlugin(registry: PluginRegistry): void {
  registry.register({
    id: "example-panel",
    name: "Example Panel",
    version: "1.0.0",
    description:
      "A built-in UI-safe example plugin that validates the plugin boundary.",
    author: "Mamep2026 Team",
    platform: { web: true, node: false },
    permissions: ["ui.panel"],
    contributions: {
      panels: [{ id: "example-info", titleKey: "plugins.exampleTitle" }],
    },
  });
}

export default function App(): React.ReactNode {
  const hostRef = useRef<AppHost | null>(null);
  const setHost = useAppStore((s) => s.setHost);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const setLoaded = useAppStore((s) => s.setLoaded);
  const setConnectionModalOpen = useAppStore((s) => s.setConnectionModalOpen);
  const appendMessage = useAppStore((s) => s.appendMessage);
  const appendCommLog = useAppStore((s) => s.appendCommLog);
  const setSaveStatus = useAppStore((s) => s.setSaveStatus);
  const updateRow = useAppStore((s) => s.updateRow);
  const setConnectionState = useAppStore((s) => s.setConnectionState);

  const mockTransport = useMemo(() => isMockMode(), []);

  // 启动装配（一次）。宿主 renderer 由 preload / vscode-bridge 暴露 window.mamepHost
  // （白名单桥），按 platform 判别窄化分支装配：VSCode Webview → VscodeAppHost、
  // Electron → ElectronAppHost；否则按浏览器 Host 装配（Web Serial + IndexedDB）。
  useEffect(() => {
    const bridge = window.mamepHost;
    const host: AppHost =
      bridge !== undefined
        ? bridge.platform === "vscode"
          ? new VscodeAppHost(bridge)
          : new ElectronAppHost(bridge)
        : (() => {
            const serial = navigator.serial;
            const platformHost =
              serial !== undefined
                ? new BrowserPlatformHost({ serial })
                : new BrowserPlatformHost({});
            // 工作区与插件存储共享同一 IndexedDB KV（不同 key：workspace / plugins）。
            const kv = createIdbKeyValueStore();
            return new BrowserAppHost({
              platform: platformHost,
              repository: new IndexedDBWorkspaceRepository(kv),
              mockTransport,
              // 插件持久化（2026-08-30，ADR-038）：IndexedDB 独立 key。
              pluginStore: new IndexedDBPluginStore(kv),
            });
          })();
    hostRef.current = host;
    registerExamplePlugin(host.pluginRegistry);
    setHost(host);

    // 日志/保存/连接状态/轮询结果接线。
    host.subscribeCommLog((event) => appendCommLog(toCommLogEntry(event)));
    host.subscribeMessage((message: ApplicationMessage) =>
      appendMessage(message),
    );
    host.subscribeSaveStatus((status) => setSaveStatus(status));
    host.subscribeConnectionState((state) => setConnectionState(state));
    host.subscribePollResult((key, address, result) => {
      // 轮询/全表读取逐行结果 → 三态状态点：成功清失败/编辑完成态（不产生成功点）；
      // 失败幂等写失败态（同因子返回原引用，设备掉线时 store 零更新）。
      useAppStore.getState().recordPollResult(key as RowId, result);
      if (!result.ok) return;
      const state = useAppStore.getState();
      const profile =
        state.workspace.connectionProfiles[0] ?? createDefaultRtuProfile();
      // 应用层纯函数完成 generation 校验与按 Type 格式化（§17）。
      const updated = applyPollResult(
        state.workspace.sheets,
        key,
        address,
        result.value,
        // TCP 恒为 off（ADR-022）；仅 RTU 才有 Address Adjust。
        profile.protocol === "rtu" ? profile.addressAdjust : "off",
      );
      if (updated !== null) updateRow(key as RowId, () => updated);
    });

    // 启动：加载工作区。
    void host
      .loadWorkspace()
      .then((result) => {
        if (result.ok) {
          setWorkspace(result.value);
        } else {
          // 恢复失败给出明确提示（§16.5.6），应用以空工作区保持可操作。
          appendMessage({
            timestamp: Date.now(),
            level: "error",
            messageKey: "messages.loadFailed",
            params: { detail: result.error.code },
            detail: result.error.code,
          });
          if (host.isMockMode && host instanceof BrowserAppHost) {
            // mock 模式：恢复失败同样预填分类寄存器，保证测试环境一致。
            setWorkspace(host.createFreshWorkspace());
          }
        }
        setLoaded();
        appendMessage({
          timestamp: Date.now(),
          level: "info",
          messageKey: "messages.appStarted",
          detail: null,
        });
        if (host.isMockMode) {
          // Mock 模式：跳过 Connection Settings，用默认 RTU 配置直接连接模拟设备。
          const profile =
            (result.ok ? result.value.connectionProfiles[0] : undefined) ??
            createDefaultRtuProfile();
          // Mock 模式仅浏览器（RTU 连接）；工作区若存了 TCP profile 则回退默认 RTU。
          const rtuProfile =
            profile.protocol === "rtu" ? profile : createDefaultRtuProfile();
          void host.connect(rtuProfile, null).then((connectResult) => {
            if (!connectResult.ok) {
              appendMessage({
                timestamp: Date.now(),
                level: "error",
                messageKey: "messages.connectFailed",
                detail: connectResult.error.technicalMessage,
              });
            }
          });
        } else {
          // 非 Mock 模式：启动自动弹出 Connection Settings。
          setConnectionModalOpen(true);
        }
      })
      .catch(() => {
        setLoaded();
        if (!host.isMockMode) {
          setConnectionModalOpen(true);
        }
      });

    return () => {
      // 释放 host（断开会话 + 退订桥事件 + 清空订阅），避免 StrictMode 双挂载下旧 host
      // 残留订阅导致事件重复投递（comm-log 一条变两条，2026-08-23）。
      void host.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      const profile =
        state.workspace.connectionProfiles[0] ?? createDefaultRtuProfile();
      // 应用层纯函数构建轮询目标（含 Address Adjust 偏移与地址 0 跳过）；
      // TCP 恒为 off（ADR-022），仅 RTU 才有 Address Adjust。
      host.updatePollingTargets(
        buildPollingTargets(
          state.workspace.sheets,
          profile.protocol === "rtu" ? profile.addressAdjust : "off",
        ),
      );
    });
  }, []);

  return <MamepApp />;
}
