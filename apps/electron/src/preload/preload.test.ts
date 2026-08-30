/**
 * Preload 白名单桥单测（docs/TECH_DESIGN.md §22.1：只暴露白名单 API、Envelope 正确、
 * 错误映射、事件订阅/取消）。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOST_MESSAGE_PROTOCOL_VERSION,
  MAMEP_IPC_EVENT_CHANNEL,
  MAMEP_IPC_INVOKE_CHANNEL,
  type MamepHostApi,
  type MamepHostEvent,
} from "@mamep2026/platform-api";

const { exposeInMainWorld, invoke, on, removeListener } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on, removeListener },
}));

let bridge: MamepHostApi;

beforeAll(async () => {
  // 动态导入：确保 electron mock 已注册后再执行 preload 顶层
  // contextBridge.exposeInMainWorld("mamepHost", api)。
  await import("../preload/preload");
  const name = exposeInMainWorld.mock.calls[0]?.[0];
  if (name !== "mamepHost") {
    throw new Error(`expected bridge name mamepHost, got ${String(name)}`);
  }
  bridge = exposeInMainWorld.mock.calls[0]?.[1] as MamepHostApi;
});

beforeEach(() => {
  // exposeInMainWorld 只在模块加载时调用一次，不清理（断言白名单键用）。
  invoke.mockClear();
  on.mockClear();
  removeListener.mockClear();
});

describe("preload 白名单桥", () => {
  it("只暴露 mamepHost，且仅包含白名单方法", () => {
    const names = exposeInMainWorld.mock.calls.map((call) => call[0]);
    expect(names).toEqual(["mamepHost"]);
    expect(Object.keys(bridge).sort()).toEqual([
      "copyTextToClipboard",
      "getAppVersion",
      "getCapabilities",
      "getDebugState",
      "onEvent",
      "openTextFile",
      "platform",
      "pluginStoreLoad",
      "pluginStoreSave",
      "readTextFromClipboard",
      "saveTextFile",
      "selectSerialPort",
      "sessionBatchCancel",
      "sessionBatchRead",
      "sessionDisconnect",
      "sessionGetState",
      "sessionPollingStart",
      "sessionPollingStop",
      "sessionReadRow",
      "sessionSetUnitId",
      "sessionTcpConnect",
      "sessionTraceStart",
      "sessionTraceStop",
      "sessionUpdatePollingTargets",
      "sessionWriteRow",
      "workspaceClear",
      "workspaceLoad",
      "workspaceSave",
    ]);
    expect(bridge.platform).toBe("electron");
  });

  it("getCapabilities 通过 invoke 发送合法 Envelope 并映射结果", async () => {
    invoke.mockResolvedValue({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: "m",
      kind: "get-capabilities",
      ok: true,
      payload: { modbusRtu: true, modbusTcp: true },
    });
    const result = await bridge.getCapabilities();
    expect(invoke).toHaveBeenCalledWith(
      MAMEP_IPC_INVOKE_CHANNEL,
      expect.objectContaining({
        protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
        type: "request",
        kind: "get-capabilities",
        payload: {},
      }),
    );
    const envelope = invoke.mock.calls[0]?.[1] as { messageId: string };
    expect(typeof envelope.messageId).toBe("string");
    expect(envelope.messageId.length).toBeGreaterThan(0);
    expect(result).toEqual({
      ok: true,
      value: { modbusRtu: true, modbusTcp: true },
    });
  });

  it("error 响应映射为 fail(MamepError)", async () => {
    invoke.mockResolvedValue({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "error",
      messageId: "m",
      kind: "debug:get-state",
      payload: {
        code: "DEBUG_PROBE_DISABLED",
        category: "internal",
        severity: "error",
        retryable: false,
        userMessageKey: "errors.hostMessageRejected",
        technicalMessage: "debug probe is disabled in packaged builds",
      },
    });
    const result = await bridge.getDebugState();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DEBUG_PROBE_DISABLED");
    }
  });

  it("copyTextToClipboard 透传文本并映射 ok", async () => {
    invoke.mockResolvedValue({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: "m",
      kind: "copy-text-to-clipboard",
      ok: true,
      payload: null,
    });
    const result = await bridge.copyTextToClipboard("hello");
    expect(invoke).toHaveBeenCalledWith(
      MAMEP_IPC_INVOKE_CHANNEL,
      expect.objectContaining({
        kind: "copy-text-to-clipboard",
        payload: { text: "hello" },
      }),
    );
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("saveTextFile 透传 CSV 内容并映射 saved 响应（2026-08-28）", async () => {
    invoke.mockResolvedValue({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: "m",
      kind: "save-text-file",
      ok: true,
      payload: { saved: true, filePath: "C:\\logs\\comm-log.csv" },
    });
    const result = await bridge.saveTextFile({
      suggestedName: "comm-log-rtu-20260828-102030.csv",
      content: "seq,timestamp\r\n",
      mimeType: "text/csv",
    });
    expect(invoke).toHaveBeenCalledWith(
      MAMEP_IPC_INVOKE_CHANNEL,
      expect.objectContaining({
        kind: "save-text-file",
        payload: {
          suggestedName: "comm-log-rtu-20260828-102030.csv",
          content: "seq,timestamp\r\n",
          mimeType: "text/csv",
        },
      }),
    );
    expect(result).toEqual({
      ok: true,
      value: { saved: true, filePath: "C:\\logs\\comm-log.csv" },
    });
  });

  it("openTextFile 透传 suggestedName 并映射 content 响应（2026-08-29）", async () => {
    invoke.mockResolvedValue({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: "m",
      kind: "open-text-file",
      ok: true,
      payload: { content: '{"schemaVersion":4}' },
    });
    const result = await bridge.openTextFile({
      suggestedName: "mamep-workspace.json",
    });
    expect(invoke).toHaveBeenCalledWith(
      MAMEP_IPC_INVOKE_CHANNEL,
      expect.objectContaining({
        kind: "open-text-file",
        payload: { suggestedName: "mamep-workspace.json" },
      }),
    );
    expect(result).toEqual({
      ok: true,
      value: { content: '{"schemaVersion":4}' },
    });
  });

  it("openTextFile 无参数时 payload 为空对象（2026-08-29）", async () => {
    invoke.mockResolvedValue({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: "m",
      kind: "open-text-file",
      ok: true,
      payload: { content: null },
    });
    const result = await bridge.openTextFile();
    expect(invoke).toHaveBeenCalledWith(
      MAMEP_IPC_INVOKE_CHANNEL,
      expect.objectContaining({
        kind: "open-text-file",
        payload: {},
      }),
    );
    expect(result).toEqual({ ok: true, value: { content: null } });
  });

  it("workspaceLoad 透传空 payload 并映射 content 响应（2026-08-30）", async () => {
    invoke.mockResolvedValue({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: "m",
      kind: "workspace-load",
      ok: true,
      payload: { content: '{"schemaVersion":4}' },
    });
    const result = await bridge.workspaceLoad();
    expect(invoke).toHaveBeenCalledWith(
      MAMEP_IPC_INVOKE_CHANNEL,
      expect.objectContaining({
        kind: "workspace-load",
        payload: {},
      }),
    );
    expect(result).toEqual({
      ok: true,
      value: { content: '{"schemaVersion":4}' },
    });
  });

  it("workspaceSave 透传序列化 JSON 字符串并映射 ok（2026-08-30）", async () => {
    invoke.mockResolvedValue({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: "m",
      kind: "workspace-save",
      ok: true,
      payload: null,
    });
    const content = '{"schemaVersion":4}';
    const result = await bridge.workspaceSave(content);
    expect(invoke).toHaveBeenCalledWith(
      MAMEP_IPC_INVOKE_CHANNEL,
      expect.objectContaining({
        kind: "workspace-save",
        payload: { content },
      }),
    );
    expect(result).toEqual({ ok: true, value: null });
  });

  it("workspaceClear 透传空 payload 并映射 ok（2026-08-30）", async () => {
    invoke.mockResolvedValue({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: "m",
      kind: "workspace-clear",
      ok: true,
      payload: null,
    });
    const result = await bridge.workspaceClear();
    expect(invoke).toHaveBeenCalledWith(
      MAMEP_IPC_INVOKE_CHANNEL,
      expect.objectContaining({
        kind: "workspace-clear",
        payload: {},
      }),
    );
    expect(result).toEqual({ ok: true, value: null });
  });

  it("pluginStoreLoad 透传空 payload 并映射插件存储响应（2026-08-30）", async () => {
    invoke.mockResolvedValue({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: "m",
      kind: "plugin-store-load",
      ok: true,
      payload: { schemaVersion: 1, plugins: [] },
    });
    const result = await bridge.pluginStoreLoad();
    expect(invoke).toHaveBeenCalledWith(
      MAMEP_IPC_INVOKE_CHANNEL,
      expect.objectContaining({
        kind: "plugin-store-load",
        payload: {},
      }),
    );
    expect(result).toEqual({
      ok: true,
      value: { schemaVersion: 1, plugins: [] },
    });
  });

  it("pluginStoreSave 透传插件存储数据并映射 ok（2026-08-30）", async () => {
    invoke.mockResolvedValue({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: "m",
      kind: "plugin-store-save",
      ok: true,
      payload: null,
    });
    const data = { schemaVersion: 1 as const, plugins: [] };
    const result = await bridge.pluginStoreSave(data);
    expect(invoke).toHaveBeenCalledWith(
      MAMEP_IPC_INVOKE_CHANNEL,
      expect.objectContaining({
        kind: "plugin-store-save",
        payload: { data },
      }),
    );
    expect(result).toEqual({ ok: true, value: null });
  });

  it("selectSerialPort 透传 portId 并映射 ok(null)", async () => {
    invoke.mockResolvedValue({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: "m",
      kind: "select-serial-port",
      ok: true,
      payload: null,
    });
    const result = await bridge.selectSerialPort("port-1");
    expect(invoke).toHaveBeenCalledWith(
      MAMEP_IPC_INVOKE_CHANNEL,
      expect.objectContaining({
        kind: "select-serial-port",
        payload: { portId: "port-1" },
      }),
    );
    expect(result).toEqual({ ok: true, value: null });
  });

  it("selectSerialPort 错误响应映射为 fail(MamepError)", async () => {
    invoke.mockResolvedValue({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "error",
      messageId: "m",
      kind: "select-serial-port",
      payload: {
        code: "SERIAL_PICKER_NOT_ACTIVE",
        category: "internal",
        severity: "error",
        retryable: false,
        userMessageKey: "errors.hostMessageRejected",
        technicalMessage: "no pending serial port selection for this sender",
      },
    });
    const result = await bridge.selectSerialPort("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SERIAL_PICKER_NOT_ACTIVE");
    }
  });

  it("readTextFromClipboard 空文本映射为 null", async () => {
    invoke.mockResolvedValue({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: "m",
      kind: "read-text-from-clipboard",
      ok: true,
      payload: "",
    });
    const result = await bridge.readTextFromClipboard();
    expect(result).toEqual({ ok: true, value: null });
  });

  it("onEvent 订阅与取消", () => {
    let handler: (_event: unknown, raw: unknown) => void = () => {};
    on.mockImplementation((_channel: string, h: () => void) => {
      handler = h;
    });
    const received: MamepHostEvent[] = [];
    const unsubscribe = bridge.onEvent((event) => received.push(event));

    expect(on).toHaveBeenCalledWith(MAMEP_IPC_EVENT_CHANNEL, expect.any(Function));
    handler({}, {
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "event",
      messageId: "e",
      kind: "connection-state",
      payload: { state: "connected" },
    });
    expect(received).toEqual([
      { kind: "connection-state", payload: { state: "connected" } },
    ]);

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(MAMEP_IPC_EVENT_CHANNEL, handler);
  });
});
