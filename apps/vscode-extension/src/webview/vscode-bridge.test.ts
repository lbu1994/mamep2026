// @vitest-environment jsdom
/**
 * VSCode Webview 桥单测：request Envelope 构造、按 messageId 关联响应/错误、
 * 事件剥壳投递、白名单键、非法消息忽略。
 */
import { describe, expect, it } from "vitest";
import { HOST_MESSAGE_PROTOCOL_VERSION } from "@mamep2026/platform-api";
import {
  createVscodeBridge,
  type VsCodeApi,
} from "./vscode-bridge";

function createHarness() {
  const posted: unknown[] = [];
  const api: VsCodeApi = {
    postMessage: (message) => {
      posted.push(message);
    },
    getState: () => null,
    setState: () => undefined,
  };
  const bridge = createVscodeBridge(api, window);
  const dispatch = (data: unknown): void => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  };
  return { posted, bridge, dispatch };
}

describe("createVscodeBridge（HostMessage v1 编解码）", () => {
  it("get-capabilities 发送 request Envelope 并按 messageId 关联响应", async () => {
    const { posted, bridge, dispatch } = createHarness();
    const promise = bridge.getCapabilities();
    expect(posted).toHaveLength(1);
    const envelope = posted[0] as Record<string, unknown>;
    expect(envelope).toMatchObject({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      kind: "get-capabilities",
      payload: {},
    });
    expect(typeof envelope.messageId).toBe("string");
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: envelope.messageId,
      kind: "get-capabilities",
      ok: true,
      payload: {
        modbusRtu: false,
        modbusTcp: true,
        serialPorts: "unsupported",
        filesystem: "unsupported",
        nodePlugins: false,
        webPlugins: true,
      },
    });
    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it("error 响应映射为结构化失败（还原 MamepError）", async () => {
    const { posted, bridge, dispatch } = createHarness();
    const promise = bridge.copyTextToClipboard("hi");
    const envelope = posted[0] as Record<string, unknown>;
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "error",
      messageId: envelope.messageId,
      kind: "host-error",
      payload: {
        code: "CLIPBOARD_WRITE_FAILED",
        category: "internal",
        severity: "error",
        retryable: false,
        userMessageKey: "errors.hostMessageRejected",
        technicalMessage: "denied",
      },
    });
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CLIPBOARD_WRITE_FAILED");
      expect(result.error.technicalMessage).toBe("denied");
    }
  });

  it("copy-text-to-clipboard 携带 text payload", async () => {
    const { posted, bridge } = createHarness();
    void bridge.copyTextToClipboard("hello");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      kind: "copy-text-to-clipboard",
      payload: { text: "hello" },
    });
  });

  it("onEvent 剥壳投递宿主事件，退订函数生效", async () => {
    const { bridge, dispatch } = createHarness();
    const received: Array<{ kind: string; payload: unknown }> = [];
    const unsubscribe = bridge.onEvent((event) => {
      received.push({ kind: event.kind, payload: event.payload });
    });
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "event",
      messageId: "evt-1",
      kind: "color-theme-changed",
      payload: { theme: "dark" },
    });
    expect(received).toEqual([{ kind: "color-theme-changed", payload: { theme: "dark" } }]);
    unsubscribe();
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "event",
      messageId: "evt-2",
      kind: "color-theme-changed",
      payload: { theme: "light" },
    });
    expect(received).toHaveLength(1);
  });

  it("非法/非协议消息被忽略（不崩溃、不误匹配）", async () => {
    const { posted, bridge, dispatch } = createHarness();
    const promise = bridge.getAppVersion();
    dispatch({ arbitrary: "vscode-internal-message" });
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "event",
      messageId: "evt-x",
      kind: "unknown-event-kind",
      payload: {},
    });
    // 用错误 messageId 的响应不会 resolve 挂起请求。
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: "wrong-id",
      kind: "get-app-version",
      ok: true,
      payload: "nope",
    });
    expect(posted).toHaveLength(1);
    // 正确 messageId 才 resolve。
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: (posted[0] as Record<string, unknown>).messageId,
      kind: "get-app-version",
      ok: true,
      payload: "0.0.0-test",
    });
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("0.0.0-test");
  });

  it("暴露白名单键（无任意 acquireVsCodeApi 能力）", () => {
    const { bridge } = createHarness();
    const keys = Object.keys(bridge).sort();
    expect(keys).toEqual(
      [
        "copyTextToClipboard",
        "enumerateSerialPorts",
        "getAppVersion",
        "getCapabilities",
        "getColorTheme",
        "getDebugState",
        "loadConnectionConfig",
        "onEvent",
        "platform",
        "readTextFromClipboard",
        "selectSerialPort",
        "sessionBatchCancel",
        "sessionBatchRead",
        "sessionConnect",
        "sessionDisconnect",
        "sessionGetState",
        "sessionPollingStart",
        "sessionPollingStop",
        "sessionReadRow",
        "sessionSetSlaveAddress",
        "sessionTraceStart",
        "sessionTraceStop",
        "sessionTcpConnect",
        "sessionUpdatePollingTargets",
        "sessionWriteRow",
      ].sort(),
    );
    expect(
      (bridge as unknown as Record<string, unknown>).postMessage,
    ).toBeUndefined();
  });
});
