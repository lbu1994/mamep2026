/**
 * 共享 AppHost 测试桩（ConnectionSettingsModal 等组件测试共用）。
 * 真实注册表（组件经 usePluginContributions 读取 tableType 贡献，空对象 mock 缺
 * getVersion 会崩）；browserCompatibility 默认 null（桌面语义），组件兼容性测试可覆盖。
 */
import { vi } from "vitest";
import { createEmptyWorkspace } from "@mamep2026/domain";
import type {
  BrowserCompatibility,
  PlatformCapabilities,
  Result,
} from "@mamep2026/domain";
import { PluginRegistry } from "@mamep2026/plugin-api";
import type { AppHost } from "../host";

export function makeHost(
  caps: Partial<PlatformCapabilities> = {},
  overrides: {
    supportsWebSerial?: () => boolean;
    browserCompatibility?: BrowserCompatibility | null;
  } = {},
): { host: AppHost; connectTcp: ReturnType<typeof vi.fn> } {
  const connectTcp = vi.fn(async (): Promise<Result<void>> => ({
    ok: true as const,
    value: undefined,
  }));
  const host: AppHost = {
    capabilities: {
      modbusRtu: true,
      modbusTcp: true,
      serialPorts: "enumerated",
      filesystem: "unsupported",
      nodePlugins: false,
      webPlugins: true,
      logExport: "save-dialog",
      workspaceImport: "upload",
      workspaceExport: "download",
      pluginInstall: "upload",
      executablePlugins: false,
      hostPlugins: false,
      protocolExtensions: [],
      tableTypes: ["holding-register"],
      ...caps,
    },
    isMockMode: false,
    pluginRegistry: new PluginRegistry(),
    appVersion: "0.0.0-test",
    startPlugins: vi.fn(async () => undefined),
    restoreBundledPlugin: vi.fn(async () => undefined),
    restoreAllBundledPlugins: vi.fn(async () => undefined),
    loadWorkspace: vi.fn(async () => ({
      ok: true as const,
      value: createEmptyWorkspace(),
    })),
    resetWorkspace: vi.fn(async () => ({
      ok: true as const,
      value: createEmptyWorkspace(),
    })),
    scheduleSave: vi.fn(),
    getSaveStatus: vi.fn(() => "saved" as const),
    subscribeSaveStatus: vi.fn(() => () => undefined),
    supportsWebSerial: overrides.supportsWebSerial ?? vi.fn(() => false),
    browserCompatibility: overrides.browserCompatibility ?? null,
    enumerateSerialPorts: vi.fn(async () => ({
      ok: true as const,
      value: [] as never[],
    })),
    selectSerialPort: vi.fn(async () => ({ ok: true as const, value: null })),
    connect: vi.fn(async () => ({ ok: true as const, value: undefined })),
    connectTcp,
    disconnect: vi.fn(async () => ({ ok: true as const, value: undefined })),
    dispose: vi.fn(async () => undefined),
    getConnectionState: vi.fn(() => "disconnected" as const),
    getSession: vi.fn(() => null),
    createPluginRemoteRuntime: vi.fn(),
    getCommProperties: vi.fn(),
    setSlaveAddress: vi.fn(),
    setAddressTransform: vi.fn(),
    subscribeConnectionState: vi.fn(() => () => undefined),
    readRow: vi.fn(),
    writeRow: vi.fn(),
    readAllRows: vi.fn(),
    updatePollingTargets: vi.fn(),
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    subscribePollResult: vi.fn(() => () => undefined),
    traceStart: vi.fn(),
    traceStop: vi.fn(),
    subscribeTraceSample: vi.fn(() => () => undefined),
    subscribeCommLog: vi.fn(() => () => undefined),
    subscribeMessage: vi.fn(() => () => undefined),
    pushMessage: vi.fn(),
    copyTextToClipboard: vi.fn(async () => ({
      ok: true as const,
      value: undefined,
    })),
    readTextFromClipboard: vi.fn(async () => ({
      ok: true as const,
      value: null,
    })),
    saveTextFile: vi.fn(async () => ({
      ok: true as const,
      value: { saved: true, filePath: null },
    })),
    openTextFile: vi.fn(async () => ({
      ok: true as const,
      value: { content: null },
    })),
    pluginRuntimeLoad: vi.fn(async () => ({ ok: true as const, value: null })),
    pluginRuntimeUnload: vi.fn(async () => ({
      ok: true as const,
      value: null,
    })),
    pluginRpc: vi.fn(async () => ({ ok: true as const, value: null })),
    pluginContributionQuery: vi.fn(async () => ({
      ok: true as const,
      value: { points: [] },
    })),
  };
  return { host, connectTcp };
}
