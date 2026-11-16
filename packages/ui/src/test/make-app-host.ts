/**
 * 共享 AppHost 测试桩（ConnectionSettingsModal 等组件测试共用）。
 * 真实注册表（组件经 usePluginContributions 读取 tableType 贡献，空对象 mock 缺
 * getVersion 会崩）；browserCompatibility 默认 null（桌面语义），组件兼容性测试可覆盖。
 */
import { vi } from "vitest";
import { browserCapabilities, createEmptyWorkspace } from "@mamep2026/domain";
import type {
  BrowserCompatibility,
  PlatformCapabilities,
  Result,
} from "@mamep2026/domain";
import { PluginRegistry } from "@mamep2026/plugin-api";
import type { AppHost } from "../host";

/** 插件入口加载失败的结构化错误（默认桩：测试不实际安装插件）。 */
function pluginEntryUnavailable() {
  return {
    ok: false as const,
    error: {
      code: "PLUGIN_LOAD_FAILED",
      category: "plugin" as const,
      severity: "error" as const,
      retryable: false,
      userMessageKey: "errors.pluginLoadFailed",
      technicalMessage: "test stub",
    },
  };
}

export function makeHost(
  caps: Partial<PlatformCapabilities> = {},
  overrides: {
    supportsWebSerial?: () => boolean;
    browserCompatibility?: BrowserCompatibility | null;
    platform?: AppHost["platform"];
    setKeepScreenOn?: AppHost["setKeepScreenOn"];
    onHardwareBack?: AppHost["onHardwareBack"];
  } = {},
): { host: AppHost; connectTcp: ReturnType<typeof vi.fn> } {
  const connectTcp = vi.fn(async (): Promise<Result<void>> => ({
    ok: true as const,
    value: undefined,
  }));
  const host: AppHost = {
    capabilities: {
      ...browserCapabilities,
      modbusTcp: true,
      serialPorts: "enumerated",
      filesystem: "unsupported",
      logExport: "save-dialog",
      workspaceImport: "upload",
      workspaceExport: "download",
      executablePlugins: false,
      protocolExtensions: [],
      tableTypes: ["holding-register"],
      ...caps,
    },
    isMockMode: false,
    pluginRegistry: new PluginRegistry(),
    appVersion: "0.0.0-test",
    platform: overrides.platform ?? "browser",
    startPlugins: vi.fn(async () => undefined),
    previewPluginEntry: vi.fn(async () => pluginEntryUnavailable()),
    installPluginEntry: vi.fn(async () => pluginEntryUnavailable()),
    loadWorkspace: vi.fn(async () => ({
      ok: true as const,
      value: createEmptyWorkspace(),
    })),
    resetWorkspace: vi.fn(async () => ({
      ok: true as const,
      value: createEmptyWorkspace(),
    })),
    scheduleSave: vi.fn(),
    flush: vi.fn(async () => ({ ok: true as const, value: undefined })),
    getWorkspaceRecoveryInfo: vi.fn(() => null),
    getSaveStatus: vi.fn(() => "saved" as const),
    subscribeSaveStatus: vi.fn(() => () => undefined),
    ...(overrides.setKeepScreenOn !== undefined
      ? { setKeepScreenOn: overrides.setKeepScreenOn }
      : {}),
    ...(overrides.onHardwareBack !== undefined
      ? { onHardwareBack: overrides.onHardwareBack }
      : {}),
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
