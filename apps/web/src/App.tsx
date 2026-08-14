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
import { applyPollResult, buildPollingTargets } from "@mamep2026/register-table";
import { MamepApp, useAppStore } from "@mamep2026/ui";
import { BrowserAppHost } from "./AppHost";

const MOCK_FLAG = "mockTransport";

function isMockMode(): boolean {
  return (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get(MOCK_FLAG) === "1"
  );
}

function toCommLogEntry(event: CommunicationLogEvent) {
  return {
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
    platform: { web: true, node: false },
    permissions: ["ui.panel"],
    contributions: {
      panels: [{ id: "example-info", titleKey: "plugins.exampleTitle" }],
    },
  });
}

export default function App(): React.ReactNode {
  const hostRef = useRef<BrowserAppHost | null>(null);
  const setHost = useAppStore((s) => s.setHost);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const setLoaded = useAppStore((s) => s.setLoaded);
  const setConnectionModalOpen = useAppStore((s) => s.setConnectionModalOpen);
  const appendMessage = useAppStore((s) => s.appendMessage);
  const appendCommLog = useAppStore((s) => s.appendCommLog);
  const setSaveStatus = useAppStore((s) => s.setSaveStatus);
  const updateRow = useAppStore((s) => s.updateRow);
  const setConnectionState = useAppStore((s) => s.setConnectionState);
  const workspace = useAppStore((s) => s.workspace);

  const mockTransport = useMemo(() => isMockMode(), []);

  // 启动装配（一次）。
  useEffect(() => {
    const serial = navigator.serial;
    const platformHost =
      serial !== undefined
        ? new BrowserPlatformHost({ serial })
        : new BrowserPlatformHost({});
    const host = new BrowserAppHost({
      platform: platformHost,
      repository: new IndexedDBWorkspaceRepository(createIdbKeyValueStore()),
      mockTransport,
    });
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
        profile.addressAdjust,
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
          void host.connect(profile, null).then((connectResult) => {
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
      void host.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 工作区变更 -> 自动保存；WP 轮询目标同步（Address Adjust 应用于轮询地址）。
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    if (workspace.sheets.length === 0) return;
    host.scheduleSave(workspace);

    const profile =
      workspace.connectionProfiles[0] ?? createDefaultRtuProfile();
    // 应用层纯函数构建轮询目标（含 Address Adjust 偏移与地址 0 跳过）。
    host.updatePollingTargets(
      buildPollingTargets(workspace.sheets, profile.addressAdjust),
    );
  }, [workspace]);

  return <MamepApp />;
}
