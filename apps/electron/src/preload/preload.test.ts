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
      "platform",
      "readTextFromClipboard",
      "selectSerialPort",
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
      payload: { modbusRtu: true, modbusTcp: false },
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
      value: { modbusRtu: true, modbusTcp: false },
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
