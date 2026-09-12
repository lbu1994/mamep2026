/**
 * VscodeAppHost 单测（VSCode 端骨架，2026-08-23）：能力矩阵如实声明（RTU/TCP/串口/文件
 * 均未支持）、主题初始化与 color-theme-changed 事件映射共享 store、剪贴板透传 VSCode 桥、
 * 工作区经注入仓储委托 inner（BrowserAppHost）、连接不虚报成功。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformCapabilities, Result } from "@mamep2026/domain";
import {
  createDefaultRtuProfile,
  createDefaultTcpProfile,
  createEmptyRow,
  RegisterAddress,
} from "@mamep2026/domain";
import type { ConnectionState } from "@mamep2026/communication";
import type {
  MamepHostEvent,
  OpenTextFileResponse,
  PluginStoreDataResponse,
  PluginContributionQueryResponse,
  SaveTextFileResponse,
  SerialPortOption,
  SessionBatchReadResponse,
  SessionStateResponse,
  VscodeHostApi,
  VscodeHostDebugState,
  WriteOutcomePayload,
} from "@mamep2026/platform-api";
import { vscodeCapabilities } from "@mamep2026/platform-api";
import { buildTheme, type CssVarSource } from "@mamep2026/ui-theme";
import { InMemoryWorkspaceRepository } from "@mamep2026/test-kit";
import { useAppStore } from "@mamep2026/ui";
import { VscodeAppHost } from "./vscode-app-host";

function createFakeBridge(): {
  bridge: VscodeHostApi;
  emit: (event: MamepHostEvent) => void;
  copyCalls: string[];
} {
  const listeners = new Set<(event: MamepHostEvent) => void>();
  const copyCalls: string[] = [];
  const bridge: VscodeHostApi = {
    platform: "vscode",
    getCapabilities: vi.fn(
      async (): Promise<Result<PlatformCapabilities>> => ({
        ok: true,
        value: vscodeCapabilities,
      }),
    ),
    getAppVersion: vi.fn(async (): Promise<Result<string>> => ({
      ok: true,
      value: "0.0.0-test",
    })),
    copyTextToClipboard: vi.fn(async (text: string): Promise<Result<void>> => {
      copyCalls.push(text);
      return { ok: true, value: undefined };
    }),
    readTextFromClipboard: vi.fn(
      async (): Promise<Result<string | null>> => ({ ok: true, value: null }),
    ),
    selectSerialPort: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    getColorTheme: vi.fn(
      async (): Promise<Result<"light" | "dark">> => ({
        ok: true,
        value: "dark",
      }),
    ),
    onEvent: vi.fn((listener: (event: MamepHostEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    getDebugState: vi.fn(
      async (): Promise<Result<VscodeHostDebugState | null>> => ({
        ok: true,
        value: null,
      }),
    ),
    // ---- 工作区文件仓储（2026-08-30，ADR-036；ADR-049 增 recoveryInfo/create-backup）：
    // VSCode filesystem unsupported，fake 返回能力错误（VscodeAppHost 不走这些桥）。----
    workspaceLoad: vi.fn(
      async (): Promise<Result<{ content: string; recoveryInfo: null }>> => ({
        ok: false,
        error: {
          code: "WORKSPACE_FILESYSTEM_UNSUPPORTED",
          category: "capability",
          severity: "error",
          retryable: false,
          userMessageKey: "errors.capabilityUnsupported",
          technicalMessage: "unsupported",
        },
      }),
    ),
    workspaceSave: vi.fn(async (): Promise<Result<null>> => ({
      ok: false,
      error: {
        code: "WORKSPACE_FILESYSTEM_UNSUPPORTED",
        category: "capability",
        severity: "error",
        retryable: false,
        userMessageKey: "errors.capabilityUnsupported",
        technicalMessage: "unsupported",
      },
    })),
    workspaceClear: vi.fn(async (): Promise<Result<null>> => ({
      ok: false,
      error: {
        code: "WORKSPACE_FILESYSTEM_UNSUPPORTED",
        category: "capability",
        severity: "error",
        retryable: false,
        userMessageKey: "errors.capabilityUnsupported",
        technicalMessage: "unsupported",
      },
    })),
    workspaceCreateBackup: vi.fn(async (): Promise<Result<null>> => ({
      ok: false,
      error: {
        code: "WORKSPACE_FILESYSTEM_UNSUPPORTED",
        category: "capability",
        severity: "error",
        retryable: false,
        userMessageKey: "errors.capabilityUnsupported",
        technicalMessage: "unsupported",
      },
    })),
    // ---- 插件存储桥（2026-08-30，ADR-038：Extension Host globalState 持久化）----
    pluginStoreLoad: vi.fn(
      async (): Promise<Result<PluginStoreDataResponse>> => ({
        ok: true,
        value: { schemaVersion: 4, plugins: [] },
      }),
    ),
    pluginStoreSave: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    // ---- 插件运行时桥（2026-08-31，ADR-039：Phase A 契约，测试不实际调用）----
    pluginRuntimeLoad: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    pluginRuntimeUnload: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    pluginRpc: vi.fn(async (): Promise<Result<unknown>> => ({
      ok: true,
      value: null,
    })),
    pluginContributionQuery: vi.fn(
      async (): Promise<Result<PluginContributionQueryResponse>> => ({
        ok: true,
        value: { points: [] },
      }),
    ),
    // ---- RTU 会话 RPC（VSCode 接线，2026-08-23）----
    enumerateSerialPorts: vi.fn(
      async (): Promise<Result<SerialPortOption[]>> => ({
        ok: true,
        value: [{ portId: "COM4", label: "Fake (COM4)" }],
      }),
    ),
    sessionConnect: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionDisconnect: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionGetState: vi.fn(
      async (): Promise<Result<SessionStateResponse>> => ({
        ok: true,
        value: { connectionState: "disconnected" },
      }),
    ),
    sessionSetSlaveAddress: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionSetUnitId: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionSetAddressTransform: vi.fn(
      async (): Promise<Result<null>> => ({ ok: true, value: null }),
    ),
    sessionReadRow: vi.fn(async (): Promise<Result<number>> => ({
      ok: true,
      value: 0x1234,
    })),
    sessionWriteRow: vi.fn(
      async (): Promise<Result<WriteOutcomePayload>> => ({
        ok: true,
        value: { kind: "write-succeeded-no-verify" },
      }),
    ),
    sessionBatchRead: vi.fn(
      async (batchId: string): Promise<Result<SessionBatchReadResponse>> => ({
        ok: true,
        value: {
          summary: {
            batchId,
            totalRows: 1,
            eligibleRows: 1,
            successCount: 1,
            failureCount: 0,
            skippedCount: 0,
            cancelledCount: 0,
            startedAt: 0,
            completedAt: 1,
            durationMs: 1,
          },
        },
      }),
    ),
    sessionBatchCancel: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionUpdatePollingTargets: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionPollingStart: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionPollingStop: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionTraceStart: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionTraceStop: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    sessionTcpConnect: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
    saveTextFile: vi.fn(async (): Promise<Result<SaveTextFileResponse>> => ({
      ok: true,
      value: { saved: true, filePath: null },
    })),
    openTextFile: vi.fn(async (): Promise<Result<OpenTextFileResponse>> => ({
      ok: true,
      value: { content: '{"schemaVersion":4}' },
    })),
  };
  return {
    bridge,
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
    copyCalls,
  };
}

function makeHost(
  bridge: VscodeHostApi,
  options: {
    cssVarSource?: CssVarSource;
    scheduleFrame?: (cb: () => void) => void;
  } = {},
): VscodeAppHost {
  return new VscodeAppHost(bridge, {
    repository: new InMemoryWorkspaceRepository(),
    // node 环境无 DOM：注入空变量源 + 同步帧调度（生产走 getComputedStyle/rAF）。
    cssVarSource: options.cssVarSource ?? { getPropertyValue: () => "" },
    scheduleFrame: options.scheduleFrame ?? ((cb) => cb()),
  });
}

/** 构造带主题 CSS 变量读取源的 fake（可按需修改 map 模拟主题变化）。 */
function themedCssVarSource(
  vars: Record<string, string>,
): CssVarSource {
  return { getPropertyValue: (name) => vars[name] ?? "" };
}

describe("VscodeAppHost", () => {
  beforeEach(() => {
    // 重置共享 store 主题与主题令牌，避免跨测试污染。
    useAppStore.getState().setTheme("light");
    useAppStore.getState().setThemeConfig(null);
  });

  it("能力矩阵如实声明（RTU/TCP 已接线：modbusRtu/modbusTcp true、serialPorts enumerated）", () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    // ADR-054：能力矩阵读取即派生（基础值 + 已启用插件贡献）；无插件时与基础值深等。
    expect(host.capabilities).toEqual(vscodeCapabilities);
    expect(host.capabilities.modbusRtu).toBe(true);
    expect(host.capabilities.modbusTcp).toBe(true);
    expect(host.capabilities.serialPorts).toBe("enumerated");
    expect(host.capabilities.filesystem).toBe("unsupported");
    expect(host.isMockMode).toBe(false);
  });

  it("构造时经 get-color-theme 初始化共享 store 主题", async () => {
    const { bridge } = createFakeBridge();
    makeHost(bridge);
    await vi.waitFor(() => {
      expect(useAppStore.getState().theme).toBe("dark");
    });
    expect(bridge.getColorTheme).toHaveBeenCalled();
  });

  it("color-theme-changed 事件更新共享 store 主题", async () => {
    const { bridge, emit } = createFakeBridge();
    makeHost(bridge);
    // 先等构造期 get-color-theme 完成（默认 dark），再验证事件路径。
    await vi.waitFor(() => {
      expect(useAppStore.getState().theme).toBe("dark");
    });
    emit({ kind: "color-theme-changed", payload: { theme: "light" } });
    expect(useAppStore.getState().theme).toBe("light");
  });

  it("构造后读 --vscode-* 变量装配完整主题令牌到 store（ADR-027）", async () => {
    const { bridge } = createFakeBridge();
    makeHost(bridge, {
      cssVarSource: themedCssVarSource({
        "--vscode-editor-background": "#1e1e1e",
        "--vscode-editor-foreground": "#d4d4d4",
      }),
    });
    // 等 get-color-theme（dark）完成后 themeConfig 以暗色重建。
    await vi.waitFor(() => {
      const config = useAppStore.getState().themeConfig;
      expect(config?.token?.colorBgContainer).toBe("#1e1e1e");
      expect(config?.token?.colorText).toBe("rgb(212, 212, 212)");
    });
  });

  it("color-theme-changed 事件重读 CSS 变量并重建主题令牌", async () => {
    const vars: Record<string, string> = {
      "--vscode-editor-background": "#1e1e1e",
      "--vscode-editor-foreground": "#d4d4d4",
    };
    const { bridge, emit } = createFakeBridge();
    makeHost(bridge, { cssVarSource: themedCssVarSource(vars) });
    await vi.waitFor(() => {
      expect(useAppStore.getState().theme).toBe("dark");
    });
    // 模拟宿主主题切换后 CSS 变量更新：事件触发重读应拿到新背景。
    vars["--vscode-editor-background"] = "#202020";
    emit({ kind: "color-theme-changed", payload: { theme: "dark" } });
    await vi.waitFor(() => {
      expect(useAppStore.getState().themeConfig?.token?.colorBgContainer).toBe(
        "#202020",
      );
    });
  });

  it("无 --vscode 变量时 themeConfig 回退 base（buildTheme 两态）", async () => {
    const { bridge } = createFakeBridge();
    makeHost(bridge);
    await vi.waitFor(() => {
      expect(useAppStore.getState().theme).toBe("dark");
    });
    const config = useAppStore.getState().themeConfig;
    // buildVscodeTheme({}, dark) = merge(buildTheme(dark), {}) → 品牌/状态来自 base。
    expect(config?.token?.colorPrimary).toBe(buildTheme(true).token?.colorPrimary);
    expect(config?.token?.colorBgContainer).toBeUndefined();
  });

  it("剪贴板透传 VSCode 桥", async () => {
    const { bridge, copyCalls } = createFakeBridge();
    const host = makeHost(bridge);
    const result = await host.copyTextToClipboard("hello");
    expect(result.ok).toBe(true);
    expect(copyCalls).toEqual(["hello"]);
  });

  it("saveTextFile（CSV 导出）透传 VSCode 桥", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    const result = await host.saveTextFile({
      suggestedName: "comm-log-rtu-20260828-102030.csv",
      content: "seq,timestamp\r\n",
      mimeType: "text/csv",
    });
    expect(result).toEqual({
      ok: true,
      value: { saved: true, filePath: null },
    });
    expect(bridge.saveTextFile).toHaveBeenCalledWith({
      suggestedName: "comm-log-rtu-20260828-102030.csv",
      content: "seq,timestamp\r\n",
      mimeType: "text/csv",
    });
  });

  it("openTextFile（工作区导入）透传 VSCode 桥", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    const result = await host.openTextFile({
      suggestedName: "mamep-workspace.json",
    });
    expect(result).toEqual({
      ok: true,
      value: { content: '{"schemaVersion":4}' },
    });
    expect(bridge.openTextFile).toHaveBeenCalledWith({
      suggestedName: "mamep-workspace.json",
    });
  });

  it("工作区经注入仓储委托 inner（loadWorkspace 走通）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    const result = await host.loadWorkspace();
    expect(result.ok).toBe(true);
  });

  it("连接不虚报成功（未选择串口返回校验错误）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    const profile = createDefaultRtuProfile();
    const connect = await host.connect(profile, null);
    expect(connect.ok).toBe(false);
    if (!connect.ok) expect(connect.error.code).toBe("SERIAL_DEVICE_NOT_SELECTED");
  });
});

describe("VscodeAppHost RTU 远程会话代理（2026-08-23）", () => {
  it("connect 经 session-connect RPC 委托 Extension Host（携带 profile payload 与从站地址）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    const profile = createDefaultRtuProfile();
    const result = await host.connect(profile, { id: "COM4", label: "Fake (COM4)" });
    expect(result.ok).toBe(true);
    expect(bridge.sessionConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        portId: "COM4",
        slaveAddress: 1,
        profile: expect.objectContaining({ protocol: "rtu", baudRate: 9600 }),
      }),
    );
    expect(host.getConnectionState()).toBe("connected");
  });

  it("connect 带 options.protocol 时透传到 session-connect（非 rtu 分支）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    const profile = createDefaultRtuProfile();
    const result = await host.connect(profile, { id: "COM4", label: "Fake (COM4)" }, {
      protocol: "modbus-basic-tables:coil",
    });
    expect(result.ok).toBe(true);
    expect(bridge.sessionConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        portId: "COM4",
        protocol: "modbus-basic-tables:coil",
        profile: expect.objectContaining({ protocol: "rtu", baudRate: 9600 }),
      }),
    );
  });

  it("connect 不带 protocol 或 protocol 为 rtu 时不携带 protocol 字段", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    const profile = createDefaultRtuProfile();
    await host.connect(profile, { id: "COM4", label: "Fake (COM4)" }, { protocol: "rtu" });
    const call = (bridge.sessionConnect as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call).not.toHaveProperty("protocol");
  });

  it("session-connect 失败时连接不虚报成功", async () => {
    const { bridge } = createFakeBridge();
    (bridge.sessionConnect as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: "SERIAL_PORT_IN_USE", category: "transport", severity: "error", retryable: false, userMessageKey: "errors.serialPortInUse", technicalMessage: "in use" },
    });
    const host = makeHost(bridge);
    const result = await host.connect(createDefaultRtuProfile(), { id: "COM4", label: "x" });
    expect(result.ok).toBe(false);
    expect(host.getConnectionState()).toBe("disconnected");
  });

  it("enumerateSerialPorts 走 serial-enumerate RPC 并缓存端口列表", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    const result = await host.enumerateSerialPorts();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([{ portId: "COM4", label: "Fake (COM4)" }]);
    const handle = await host.selectSerialPort("COM4");
    expect(handle.ok).toBe(true);
    if (handle.ok) expect(handle.value).toEqual({ id: "COM4", label: "Fake (COM4)" });
  });

  it("readRow / writeRow 经 RPC 委托（row 序列化为 payload）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    const profile = createDefaultRtuProfile();
    await host.connect(profile, { id: "COM4", label: "x" });
    const row = createEmptyRow();
    const address = RegisterAddress.create(0x1000);
    if (address.ok) row.addressValue = address.value;
    const read = await host.readRow(row);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value).toBe(0x1234);
    expect(bridge.sessionReadRow).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: row.rowId,
        addressValue: { value: 0x1000 },
      }),
    );
    const write = await host.writeRow(row);
    expect(write.ok).toBe(true);
    if (write.ok) expect(write.value).toEqual({ kind: "write-succeeded-no-verify" });
  });

  it("writeRow 携带 writeVerify 经 sessionWriteRow 转发（2026-08-26）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    const row = createEmptyRow();
    const address = RegisterAddress.create(0x1000);
    if (address.ok) row.addressValue = address.value;
    row.cellText = "1234";
    const write = await host.writeRow(row, {
      writeVerify: { mode: "delayed", delayMs: 100 },
    });
    expect(write.ok).toBe(true);
    expect(bridge.sessionWriteRow).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: row.rowId,
        addressValue: { value: 0x1000 },
      }),
      { mode: "delayed", delayMs: 100 },
    );
  });

  it("connection-state 事件更新缓存并通知订阅者", () => {
    const { bridge, emit } = createFakeBridge();
    const host = makeHost(bridge);
    const states: ConnectionState[] = [];
    host.subscribeConnectionState((s) => states.push(s));
    emit({ kind: "connection-state", payload: { state: "connected" } });
    expect(host.getConnectionState()).toBe("connected");
    expect(states).toEqual(["connected"]);
  });

  it("poll-result 事件经 fromResultPayload 还原并通知订阅者", () => {
    const { bridge, emit } = createFakeBridge();
    const host = makeHost(bridge);
    const results: Array<[string, number, number]> = [];
    host.subscribePollResult((key, _address, result) => {
      if (result.ok)
        results.push([
          key,
          _address,
          Array.isArray(result.value) ? (result.value[0] ?? 0) : result.value,
        ]);
    });
    emit({ kind: "poll-result", payload: { key: "row-a", address: 1, result: { ok: true, value: 0xabcd } } });
    expect(results).toEqual([["row-a", 1, 0xabcd]]);
  });

  it("comm-log 事件还原 CommunicationLogEvent（bytes 从 hex 还原）", () => {
    const { bridge, emit } = createFakeBridge();
    const host = makeHost(bridge);
    const bytes: number[][] = [];
    host.subscribeCommLog((e) => bytes.push(Array.from(e.bytes)));
    emit({
      kind: "comm-log",
      payload: {
        event: {
          timestamp: 1,
          direction: "request",
          bytesHex: "010300000001",
          protocol: "rtu",
          slaveAddress: 1,
          functionCode: 3,
          userAddress: 0,
          sentAddress: 0,
          quantity: 1,
          attempt: 1,
          status: "success",
          errorCode: null,
          exceptionCode: null,
          source: "manual-read",
          durationMs: null,
        },
      },
    });
    expect(bytes).toEqual([[1, 3, 0, 0, 0, 1]]);
  });

  it("app-message 事件（设备拔出）通知订阅者", () => {
    const { bridge, emit } = createFakeBridge();
    const host = makeHost(bridge);
    const keys: string[] = [];
    host.subscribeMessage((m) => keys.push(m.messageKey));
    emit({
      kind: "app-message",
      payload: {
        message: { timestamp: 1, level: "error", messageKey: "messages.deviceDisconnected", detail: null },
      },
    });
    expect(keys).toEqual(["messages.deviceDisconnected"]);
  });

  it("readAllRows 单次往返：携带渲染端 batchId，cancel 经 session-batch-cancel 转发（ADR-025）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    const handle = host.readAllRows([{ key: "row-a", address: 1 }]);
    const summary = await handle.promise;
    expect(summary.ok).toBe(true);
    if (summary.ok) expect(summary.value.successCount).toBe(1);

    // 渲染端生成唯一 batchId 并随 session-batch-read 请求传入。
    const call = (bridge.sessionBatchRead as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(call?.[0]).toMatch(/^batch-/);
    expect(call?.[1]).toEqual([{ key: "row-a", address: 1 }]);

    // cancel 经 session-batch-cancel RPC 转发同一 batchId（幂等、异常安全）。
    const batchId = call?.[0];
    handle.cancel();
    expect(bridge.sessionBatchCancel).toHaveBeenCalledWith(batchId);
  });

  it("traceStart/traceStop 与 polling 命令经 RPC 委托", () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    host.traceStart("row-a", 1, 100);
    expect(bridge.sessionTraceStart).toHaveBeenCalledWith("row-a", 1, 100, 1);
    host.traceStop("row-a");
    expect(bridge.sessionTraceStop).toHaveBeenCalledWith("row-a");
    host.updatePollingTargets([{ key: "row-a", address: 1 }]);
    expect(bridge.sessionUpdatePollingTargets).toHaveBeenCalledWith([{ key: "row-a", address: 1 }]);
    host.startPolling();
    expect(bridge.sessionPollingStart).toHaveBeenCalled();
    host.stopPolling();
    expect(bridge.sessionPollingStop).toHaveBeenCalled();
  });
});

describe("VscodeAppHost TCP 远程会话代理（2026-08-23）", () => {
  it("connectTcp 经 session-tcp-connect RPC 委托 Extension Host（携带 TCP profile payload）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    const profile = createDefaultTcpProfile("PLC-502");
    profile.host = "192.168.1.10";
    profile.port = 502;
    profile.unitId = 1;
    const result = await host.connectTcp(profile);
    expect(result.ok).toBe(true);
    expect(bridge.sessionTcpConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({
          protocol: "tcp",
          host: "192.168.1.10",
          port: 502,
          unitId: 1,
        }),
      }),
    );
    expect(host.getConnectionState()).toBe("connected");
    // 通信属性摘要显示 host:port。
    expect(host.getCommProperties().portLabel).toBe("192.168.1.10:502");
  });

  it("session-tcp-connect 失败时连接不虚报成功", async () => {
    const { bridge } = createFakeBridge();
    (bridge.sessionTcpConnect as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: {
        code: "TCP_CONNECTION_FAILED",
        category: "connection",
        severity: "error",
        retryable: true,
        userMessageKey: "errors.tcpConnectionFailed",
        technicalMessage: "refused",
      },
    });
    const host = makeHost(bridge);
    const result = await host.connectTcp(createDefaultTcpProfile());
    expect(result.ok).toBe(false);
    expect(host.getConnectionState()).toBe("disconnected");
  });

  it("TCP 活动时 setSlaveAddress 经 session-set-unit-id 转发（2026-08-25）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    await host.connectTcp(createDefaultTcpProfile());

    host.setSlaveAddress(9);
    // TCP 路径：Unit ID 会话内动态修改经新 kind 到 Extension Host（不再守卫为 no-op）。
    expect(bridge.sessionSetUnitId).toHaveBeenCalledWith(9);
    expect(bridge.sessionSetSlaveAddress).not.toHaveBeenCalled();
  });

  it("RTU 活动时 setSlaveAddress 仍走 session-set-slave-address（每表从站地址不回归）", async () => {
    const { bridge } = createFakeBridge();
    const host = makeHost(bridge);
    // 未连接（无 TCP profile）：走 RTU 从站地址路径。
    host.setSlaveAddress(7);
    expect(bridge.sessionSetSlaveAddress).toHaveBeenCalledWith(7);
    expect(bridge.sessionSetUnitId).not.toHaveBeenCalled();
  });
});

describe("VscodeAppHost 生命周期（dispose / StrictMode 双挂载回归，2026-08-23）", () => {
  /** 构造一条 comm-log 桥事件（与宿主协议契约一致）。 */
  function commLogEvent(): MamepHostEvent {
    return {
      kind: "comm-log",
      payload: {
        event: {
          timestamp: 1,
          direction: "request",
          bytesHex: "010300000001",
          protocol: "rtu",
          slaveAddress: 1,
          functionCode: 3,
          userAddress: 0,
          sentAddress: 0,
          quantity: 1,
          attempt: 1,
          status: "success",
          errorCode: null,
          exceptionCode: null,
          source: "manual-read",
          durationMs: null,
        },
      },
    };
  }

  it("dispose 退订桥事件：之后同一桥不再向旧 host 投递 comm-log", async () => {
    const { bridge, emit } = createFakeBridge();
    const host = makeHost(bridge);
    const logs: number[][] = [];
    host.subscribeCommLog((e) => logs.push(Array.from(e.bytes)));
    await host.dispose();
    emit(commLogEvent());
    expect(logs).toEqual([]);
  });

  it("StrictMode 双挂载不重复投递：dispose 旧 host 后同一桥事件只到达新 host 一次", async () => {
    const { bridge, emit } = createFakeBridge();
    const logs: number[][] = [];
    // 第一次挂载（StrictMode effect 第一次执行）→ cleanup 仅 dispose（App.tsx 语义）。
    const host1 = makeHost(bridge);
    host1.subscribeCommLog((e) => logs.push(Array.from(e.bytes)));
    await host1.dispose();
    // 第二次挂载：新 host 再次订阅同一桥。
    const host2 = makeHost(bridge);
    host2.subscribeCommLog((e) => logs.push(Array.from(e.bytes)));
    emit(commLogEvent());
    // 修复前：host1 + host2 各投递一次 → 2 条；修复后：仅 host2 → 1 条。
    expect(logs).toHaveLength(1);
  });

  it("dispose 清空本地订阅集合：connection-state 不再投递", async () => {
    const { bridge, emit } = createFakeBridge();
    const host = makeHost(bridge);
    const states: string[] = [];
    host.subscribeConnectionState((s) => states.push(s));
    await host.dispose();
    emit({ kind: "connection-state", payload: { state: "interrupted" } });
    expect(states).toEqual([]);
  });
});
