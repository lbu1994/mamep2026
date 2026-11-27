// @vitest-environment jsdom
/**
 * VSCode Webview 桥单测：request Envelope 构造、按 messageId 关联响应/错误、
 * 事件剥壳投递、白名单键、非法消息忽略。
 */
import { describe, expect, it } from "vitest";
import { HOST_MESSAGE_PROTOCOL_VERSION } from "@mamep2026/platform-api";
import { createVscodeBridge, type VsCodeApi } from "./vscode-bridge";

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

describe("createVscodeBridge（HostMessage v2 编解码）", () => {
  it("sends trace identity and retains it in sample events", async () => {
    const { posted, bridge, dispatch } = createHarness();
    const identity = { sheetId: "sheet-1", rowId: "row-1", generation: 42 };
    const route = { unitAddress: 7, protocol: "rtu" };
    const promise = bridge.sessionTraceStart(
      "row-1",
      100,
      200,
      2,
      route,
      identity,
    );
    const request = posted[0] as Record<string, unknown>;
    expect(request).toMatchObject({ payload: { identity, route } });
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: request.messageId,
      kind: "session-trace-start",
      ok: true,
      payload: null,
    });
    expect((await promise).ok).toBe(true);
    const events: unknown[] = [];
    const unsubscribe = bridge.onEvent((event) => events.push(event));
    const sample = {
      ...identity,
      route,
      key: "row-1",
      requestId: "request-1",
      connectionId: "connection-1",
      address: 100,
      quantity: 2,
      sequence: 1,
      timestamp: 123,
      rawValue: 65538,
    };
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "event",
      messageId: "event-1",
      kind: "trace-sample",
      payload: { sample },
    });
    expect(events).toEqual([
      expect.objectContaining({ kind: "trace-sample", payload: { sample } }),
    ]);
    unsubscribe();
  });

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

  it("saveTextFile 携带 suggestedName/content/mimeType payload（2026-08-28）", async () => {
    const { posted, bridge, dispatch } = createHarness();
    const promise = bridge.saveTextFile({
      suggestedName: "comm-log-rtu-20260828-102030.csv",
      content: "seq,timestamp\r\n",
      mimeType: "text/csv",
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      kind: "save-text-file",
      payload: {
        suggestedName: "comm-log-rtu-20260828-102030.csv",
        content: "seq,timestamp\r\n",
        mimeType: "text/csv",
      },
    });
    const envelope = posted[0] as { messageId: string };
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: envelope.messageId,
      kind: "save-text-file",
      ok: true,
      payload: { saved: true, filePath: null },
    });
    const result = await promise;
    expect(result).toEqual({
      ok: true,
      value: { saved: true, filePath: null },
    });
  });

  it("openTextFile 携带 suggestedName payload 并透传 content 响应（2026-08-29）", async () => {
    const { posted, bridge, dispatch } = createHarness();
    const promise = bridge.openTextFile({
      suggestedName: "mamep-workspace.json",
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      kind: "open-text-file",
      payload: { suggestedName: "mamep-workspace.json" },
    });
    const envelope = posted[0] as { messageId: string };
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: envelope.messageId,
      kind: "open-text-file",
      ok: true,
      payload: { content: '{"schemaVersion":4}' },
    });
    const result = await promise;
    expect(result).toEqual({
      ok: true,
      value: { content: '{"schemaVersion":4}' },
    });
  });

  it("openTextFile 无参数时 payload 为空对象（2026-08-29）", async () => {
    const { posted, bridge, dispatch } = createHarness();
    const promise = bridge.openTextFile();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      kind: "open-text-file",
      payload: {},
    });
    const envelope = posted[0] as { messageId: string };
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: envelope.messageId,
      kind: "open-text-file",
      ok: true,
      payload: { content: null },
    });
    const result = await promise;
    expect(result).toEqual({ ok: true, value: { content: null } });
  });

  it("workspaceLoad 携带空 payload 并透传 content 响应（2026-08-30）", async () => {
    const { posted, bridge, dispatch } = createHarness();
    const promise = bridge.workspaceLoad();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      kind: "workspace-load",
      payload: {},
    });
    const envelope = posted[0] as { messageId: string };
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: envelope.messageId,
      kind: "workspace-load",
      ok: true,
      payload: { content: '{"schemaVersion":4}' },
    });
    const result = await promise;
    expect(result).toEqual({
      ok: true,
      value: { content: '{"schemaVersion":4}' },
    });
  });

  it("workspaceSave 携带 content payload 并映射 ok（2026-08-30）", async () => {
    const { posted, bridge, dispatch } = createHarness();
    const content = '{"schemaVersion":4}';
    const promise = bridge.workspaceSave(content);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      kind: "workspace-save",
      payload: { content },
    });
    const envelope = posted[0] as { messageId: string };
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: envelope.messageId,
      kind: "workspace-save",
      ok: true,
      payload: null,
    });
    const result = await promise;
    expect(result).toEqual({ ok: true, value: null });
  });

  it("workspaceClear 携带空 payload 并映射 ok（2026-08-30）", async () => {
    const { posted, bridge, dispatch } = createHarness();
    const promise = bridge.workspaceClear();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      kind: "workspace-clear",
      payload: {},
    });
    const envelope = posted[0] as { messageId: string };
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: envelope.messageId,
      kind: "workspace-clear",
      ok: true,
      payload: null,
    });
    const result = await promise;
    expect(result).toEqual({ ok: true, value: null });
  });

  it("workspaceCreateBackup 携带空 payload 并映射 ok（ADR-049）", async () => {
    const { posted, bridge, dispatch } = createHarness();
    const promise = bridge.workspaceCreateBackup();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      kind: "workspace-create-backup",
      payload: {},
    });
    const envelope = posted[0] as { messageId: string };
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: envelope.messageId,
      kind: "workspace-create-backup",
      ok: true,
      payload: null,
    });
    const result = await promise;
    expect(result).toEqual({ ok: true, value: null });
  });

  it("pluginStoreLoad 携带空 payload 并透传插件存储响应（2026-08-30）", async () => {
    const { posted, bridge, dispatch } = createHarness();
    const promise = bridge.pluginStoreLoad();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      kind: "plugin-store-load",
      payload: {},
    });
    const envelope = posted[0] as { messageId: string };
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: envelope.messageId,
      kind: "plugin-store-load",
      ok: true,
      payload: { schemaVersion: 6, plugins: [] },
    });
    const result = await promise;
    expect(result).toEqual({
      ok: true,
      value: { schemaVersion: 6, plugins: [] },
    });
  });

  it("pluginStoreSave 携带 data payload 并映射 ok（2026-08-30）", async () => {
    const { posted, bridge, dispatch } = createHarness();
    const data = { schemaVersion: 6 as const, plugins: [] };
    const promise = bridge.pluginStoreSave(data);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      kind: "plugin-store-save",
      payload: { data },
    });
    const envelope = posted[0] as { messageId: string };
    dispatch({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: envelope.messageId,
      kind: "plugin-store-save",
      ok: true,
      payload: null,
    });
    const result = await promise;
    expect(result).toEqual({ ok: true, value: null });
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
    expect(received).toEqual([
      { kind: "color-theme-changed", payload: { theme: "dark" } },
    ]);
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
        "onEvent",
        "openTextFile",
        "platform",
        "pluginContributionQuery",
        "pluginRpc",
        "pluginRuntimeLoad",
        "pluginRuntimeUnload",
        "pluginStoreLoad",
        "pluginStoreSave",
        "readTextFromClipboard",
        "saveTextFile",
        "selectSerialPort",
        "sessionBatchCancel",
        "sessionBatchRead",
        "sessionConnect",
        "sessionDisconnect",
        "sessionGetState",
        "sessionPollingStart",
        "sessionPollingStop",
        "sessionReadRow",
        "sessionSetAddressTransform",
        "sessionSetSlaveAddress",
        "sessionSetUnitId",
        "sessionTraceStart",
        "sessionTraceStop",
        "sessionTcpConnect",
        "sessionUpdatePollingTargets",
        "sessionWriteRow",
        "workspaceClear",
        "workspaceLoad",
        "workspaceRecovery",
        "workspaceSave",
        "workspaceCreateBackup",
      ].sort(),
    );
    expect(
      (bridge as unknown as Record<string, unknown>).postMessage,
    ).toBeUndefined();
  });
});
