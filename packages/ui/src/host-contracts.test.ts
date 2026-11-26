import { describe, expect, it } from "vitest";
import {
  browserCapabilities,
  createEmptyWorkspace,
  ok,
} from "@mamep2026/domain";
import { PluginRegistry } from "@mamep2026/plugin-api";
import type {
  AppHost,
  ClipboardHost,
  CommunicationHost,
  FileHost,
  HostIdentity,
  LoggingHost,
  PlatformLifecycleHost,
  PluginHost,
  PollingHost,
  TraceHost,
  WorkspaceHost,
} from "./host";
import { hasPlatformCapability } from "./host";

const identity: HostIdentity = {
  capabilities: browserCapabilities,
  isMockMode: false,
  appVersion: "0.0.0-test",
  platform: "browser",
};

const workspaceHost = {
  loadWorkspace: async () => ok(createEmptyWorkspace()),
  resetWorkspace: async () => ok(createEmptyWorkspace()),
  scheduleSave: () => undefined,
  flush: async () => ok(undefined),
  getWorkspaceRecoveryInfo: () => null,
  getSaveStatus: () => "saved" as const,
  subscribeSaveStatus: () => () => undefined,
} satisfies WorkspaceHost;

const communicationHost = {
  supportsWebSerial: () => false,
  browserCompatibility: null,
  enumerateSerialPorts: async () => ok([]),
  selectSerialPort: async () => ok(null),
  connect: async () => ok(undefined),
  connectTcp: async () => ok(undefined),
  disconnect: async () => ok(undefined),
  getSession: () => null,
  getConnectionState: () => "disconnected" as const,
  getCommProperties: () => ({
    protocol: "rtu" as const,
    portLabel: null,
    unitId: null,
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "off" as const,
    timeoutMs: 1000,
    retryCount: 1,
    connectionState: "disconnected" as const,
  }),
  setSlaveAddress: () => undefined,
  setAddressTransform: () => undefined,
  subscribeConnectionState: () => () => undefined,
  readRow: async () => ok(0),
  writeRow: async () => {
    throw new Error("contract fixture: writeRow not called");
  },
  readAllRows: () => {
    throw new Error("contract fixture: readAllRows not called");
  },
} satisfies CommunicationHost;

const pollingHost = {
  updatePollingTargets: () => undefined,
  startPolling: () => undefined,
  stopPolling: () => undefined,
  subscribePollResult: () => () => undefined,
} satisfies PollingHost;

const traceHost = {
  traceStart: () => undefined,
  traceStop: () => undefined,
  subscribeTraceSample: () => () => undefined,
} satisfies TraceHost;

const loggingHost = {
  subscribeCommLog: () => () => undefined,
  subscribeMessage: () => () => undefined,
  pushMessage: () => undefined,
} satisfies LoggingHost;

const clipboardHost = {
  copyTextToClipboard: async () => ok(undefined),
  readTextFromClipboard: async () => ok(null),
} satisfies ClipboardHost;

const fileHost = {
  saveTextFile: async () => ok({ saved: true, filePath: null }),
  openTextFile: async () => ok({ content: null }),
} satisfies FileHost;

const pluginHost = {
  pluginRegistry: new PluginRegistry(),
  startPlugins: async () => undefined,
  previewPluginEntry: async () => {
    throw new Error("contract fixture: previewPluginEntry not called");
  },
  setPluginEnabled: async () => ({ ok: true, value: undefined }),
  installPluginEntry: async () => {
    throw new Error("contract fixture: installPluginEntry not called");
  },
  pluginRuntimeLoad: async () => {
    throw new Error("contract fixture: pluginRuntimeLoad not called");
  },
  pluginRuntimeUnload: async () => {
    throw new Error("contract fixture: pluginRuntimeUnload not called");
  },
  pluginRpc: async () => {
    throw new Error("contract fixture: pluginRpc not called");
  },
  pluginContributionQuery: async () => {
    throw new Error("contract fixture: pluginContributionQuery not called");
  },
} satisfies PluginHost;

const lifecycleHost = {
  dispose: async () => undefined,
} satisfies PlatformLifecycleHost;

const appHost = {
  ...identity,
  ...workspaceHost,
  ...communicationHost,
  ...pollingHost,
  ...traceHost,
  ...loggingHost,
  ...clipboardHost,
  ...fileHost,
  ...pluginHost,
  ...lifecycleHost,
} satisfies AppHost;

describe("Host 子契约", () => {
  it("WorkspaceHost 不要求通信或插件职责", () => {
    expect(workspaceHost.loadWorkspace).toBeTypeOf("function");
    expect("connect" in workspaceHost).toBe(false);
    expect("pluginRegistry" in workspaceHost).toBe(false);
  });

  it("CommunicationHost 只承载会话与寄存器请求", () => {
    expect(communicationHost.connect).toBeTypeOf("function");
    expect("loadWorkspace" in communicationHost).toBe(false);
    expect("startPolling" in communicationHost).toBe(false);
    expect("traceStart" in communicationHost).toBe(false);
  });

  it("PollingHost 与 TraceHost 可由不同实现独立满足", () => {
    expect(pollingHost.startPolling).toBeTypeOf("function");
    expect("traceStart" in pollingHost).toBe(false);
    expect(traceHost.traceStart).toBeTypeOf("function");
    expect("startPolling" in traceHost).toBe(false);
  });

  it("PluginHost 不要求文件、剪贴板或通信职责", () => {
    expect(pluginHost.pluginRegistry).toBeInstanceOf(PluginRegistry);
    expect("connect" in pluginHost).toBe(false);
    expect("saveTextFile" in pluginHost).toBe(false);
    expect("copyTextToClipboard" in pluginHost).toBe(false);
  });

  it("PlatformLifecycleHost 的移动端桥保持可选", () => {
    expect(lifecycleHost.dispose).toBeTypeOf("function");
    expect("setBackgroundSuspended" in lifecycleHost).toBe(false);
    expect("setKeepScreenOn" in lifecycleHost).toBe(false);
    expect("onHardwareBack" in lifecycleHost).toBe(false);
  });

  it("AppHost 仅组合各子契约", () => {
    const composed: AppHost = appHost;
    expect(composed.platform).toBe("browser");
    expect(composed.pluginRegistry).toBeInstanceOf(PluginRegistry);
    expect(composed.readRow).toBeTypeOf("function");
    expect(composed.startPolling).toBeTypeOf("function");
    expect(composed.dispose).toBeTypeOf("function");
  });
});

describe("能力矩阵门控", () => {
  it("生命周期能力由能力矩阵声明，不以可选方法存在性代替", () => {
    const capabilities = {
      ...browserCapabilities,
      backgroundLifecycle: false,
      keepAwake: false,
      hardwareBack: false,
    };

    expect(hasPlatformCapability(capabilities, "backgroundLifecycle")).toBe(
      false,
    );
    expect(hasPlatformCapability(capabilities, "keepAwake")).toBe(false);
    expect(hasPlatformCapability(capabilities, "hardwareBack")).toBe(false);
  });

  it("剪贴板能力独立于文件与通信能力", () => {
    const capabilities = {
      ...browserCapabilities,
      clipboard: false,
      logExport: "unsupported" as const,
      modbusTcp: true,
    };

    expect(hasPlatformCapability(capabilities, "clipboard")).toBe(false);
    expect(capabilities.logExport).toBe("unsupported");
    expect(capabilities.modbusTcp).toBe(true);
  });
});
