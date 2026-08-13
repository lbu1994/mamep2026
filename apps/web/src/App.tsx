import { useEffect, useMemo, useRef } from "react";
import { formatRawValue } from "@mamep2026/data-conversion";
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
      const sheet = state.workspace.sheets.find((sh) =>
        sh.rows.some((r) => r.rowId === key),
      );
      const row = sheet?.rows.find((r) => r.rowId === key);
      if (row === undefined) return;
      // generation 失效：结果对应的请求地址必须仍是该行当前的轮询地址。
      const profile =
        state.workspace.connectionProfiles[0] ?? createDefaultRtuProfile();
      const rowAddress = row.addressValue?.value;
      if (rowAddress === undefined) return;
      const expected =
        profile.addressAdjust === "on" ? rowAddress - 1 : rowAddress;
      if (address !== 0 && address !== expected) return;
      // 读取成功：按当前 Type 格式化并强制覆盖单元格（轮询/全表共用）。
      updateRow(key as RowId, (r) => ({
        ...r,
        cellText: formatRawValue(result.value, row.dataType),
        updatedAt: Date.now(),
      }));
    });

    // 启动：加载工作区（保持离线）。
    void host
      .loadWorkspace()
      .then((result) => {
        if (result.ok) {
          setWorkspace(result.value);
        }
        setLoaded();
        appendMessage({
          timestamp: Date.now(),
          level: "info",
          messageKey: "messages.appStarted",
          detail: null,
        });
        // 每次启动自动弹出 Connection Settings。
        setConnectionModalOpen(true);
      })
      .catch(() => {
        setLoaded();
        setConnectionModalOpen(true);
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
    const adjust = profile.addressAdjust;
    const targets: Array<{ key: string; address: number }> = [];
    for (const sheet of workspace.sheets) {
      for (const row of sheet.rows) {
        if (!row.pollingEnabled) continue;
        const address = row.addressValue?.value;
        if (address === undefined) continue;
        if (adjust === "on" && address === 0) continue;
        targets.push({
          key: row.rowId,
          address: adjust === "on" ? address - 1 : address,
        });
      }
    }
    host.updatePollingTargets(targets);
  }, [workspace]);

  return <MamepApp />;
}
