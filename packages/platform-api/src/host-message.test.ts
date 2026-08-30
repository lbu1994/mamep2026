/**
 * 跨边界消息协议 v1 校验测试（docs/AGENTS.md §23）。
 */
import { describe, expect, it } from "vitest";
import {
  HOST_MESSAGE_PROTOCOL_VERSION,
  MAMEP_IPC_EVENT_CHANNEL,
  MAMEP_IPC_INVOKE_CHANNEL,
  fromErrorPayload,
  fromResultPayload,
  openTextFileResponseSchema,
  parseHostMessage,
  saveTextFileResponseSchema,
  toErrorPayload,
  toResultPayload,
  workspaceLoadResponseSchema,
} from "./host-message";
import { pluginStoreDataResponseSchema } from "./session-payloads";
import { createMamepError, fail, ok } from "@mamep2026/domain";

describe("host-message protocol v1", () => {
  it("accepts a valid get-capabilities request", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-1",
      kind: "get-capabilities",
      payload: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("request");
      expect(result.value.kind).toBe("get-capabilities");
    }
  });

  it("accepts a valid copy-text request with string payload", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-2",
      kind: "copy-text-to-clipboard",
      payload: { text: "hello" },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "request") {
      expect(result.value.payload).toEqual({ text: "hello" });
    }
  });

  it("accepts a dev debug probe request", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-debug",
      kind: "debug:get-state",
      payload: {},
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unknown request kind", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-3",
      kind: "execute-arbitrary-command",
      payload: {},
    });
    expect(result.ok).toBe(false);
  });

  it("rejects wrong protocol version", () => {
    const result = parseHostMessage({
      protocolVersion: 99,
      type: "request",
      messageId: "req-4",
      kind: "get-capabilities",
      payload: {},
    });
    expect(result.ok).toBe(false);
  });

  it("rejects request with missing payload field", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-5",
      kind: "copy-text-to-clipboard",
      payload: {},
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a valid connection-state event", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "event",
      messageId: "evt-1",
      kind: "connection-state",
      payload: { state: "disconnected" },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid get-color-theme request (VSCode skeleton)", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-theme",
      kind: "get-color-theme",
      payload: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "request") {
      expect(result.value.kind).toBe("get-color-theme");
    }
  });

  it("accepts a valid color-theme-changed event", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "event",
      messageId: "evt-theme",
      kind: "color-theme-changed",
      payload: { theme: "dark" },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a color-theme-changed event with unknown theme", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "event",
      messageId: "evt-theme-2",
      kind: "color-theme-changed",
      payload: { theme: "high-contrast" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an event with unknown state", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "event",
      messageId: "evt-2",
      kind: "connection-state",
      payload: { state: "not-a-state" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a message with unknown top-level type", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "ping",
      messageId: "x",
      kind: "get-capabilities",
      payload: {},
    });
    expect(result.ok).toBe(false);
  });

  it("round-trips a structured error projection", () => {
    const error = createMamepError({
      code: "SKELETON_NOT_IMPLEMENTED",
      category: "capability",
      userMessageKey: "errors.skeletonNotImplemented",
      technicalMessage: "not implemented yet",
    });
    const restored = fromErrorPayload(toErrorPayload(error));
    expect(restored.code).toBe("SKELETON_NOT_IMPLEMENTED");
    expect(restored.category).toBe("capability");
    expect(restored.userMessageKey).toBe("errors.skeletonNotImplemented");
  });

  it("exposes distinct invoke/event channels", () => {
    expect(MAMEP_IPC_INVOKE_CHANNEL).not.toBe(MAMEP_IPC_EVENT_CHANNEL);
  });
});

describe("host-message RTU session kinds（VSCode 接线，2026-08-23）", () => {
  const profile = {
    id: "conn-1",
    name: "RTU",
    protocol: "rtu",
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "off",
    requestTimeoutMs: 1000,
    retryCount: 1,
    interRequestDelayMs: 50,
    addressAdjust: "off",
    recentPortHint: null,
  };

  it("accepts serial-enumerate request", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-enum",
      kind: "serial-enumerate",
      payload: {},
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid session-connect request", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-connect",
      kind: "session-connect",
      payload: { portId: "COM4", profile, slaveAddress: 1 },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects session-connect with missing portId", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-connect-bad",
      kind: "session-connect",
      payload: { profile, slaveAddress: 1 },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a valid session-read-row request", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-read",
      kind: "session-read-row",
      payload: {
        row: {
          rowId: "row-1",
          order: 1,
          name: "",
          comment: "",
          addressDraft: "",
          addressValue: { value: 0x1000 },
          dataType: "hex",
          pollingEnabled: false,
          traceEnabled: false,
          cellText: "",
          registerValues: null,
          createdAt: 0,
          updatedAt: 0,
        },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects session-read-row with invalid dataType", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-read-bad",
      kind: "session-read-row",
      payload: {
        row: {
          rowId: "row-1",
          order: 1,
          name: "",
          comment: "",
          addressDraft: "",
          addressValue: { value: 1 },
          dataType: "float32",
          pollingEnabled: false,
          traceEnabled: false,
          cellText: "",
          registerValues: null,
          createdAt: 0,
          updatedAt: 0,
        },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a valid comm-log event", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "event",
      messageId: "evt-log",
      kind: "comm-log",
      payload: {
        event: {
          timestamp: 1,
          direction: "request",
          bytesHex: "01030000",
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
    expect(result.ok).toBe(true);
  });

  it("rejects comm-log event with invalid status", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "event",
      messageId: "evt-log-bad",
      kind: "comm-log",
      payload: {
        event: {
          timestamp: 1,
          direction: "request",
          bytesHex: "01030000",
          protocol: "rtu",
          slaveAddress: 1,
          functionCode: 3,
          userAddress: 0,
          sentAddress: 0,
          quantity: 1,
          attempt: 1,
          status: "nope",
          errorCode: null,
          exceptionCode: null,
          source: "manual-read",
          durationMs: null,
        },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a valid poll-result event", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "event",
      messageId: "evt-poll",
      kind: "poll-result",
      payload: {
        key: "row-a",
        address: 1,
        result: { ok: true, value: 1234 },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid app-message event", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "event",
      messageId: "evt-msg",
      kind: "app-message",
      payload: {
        message: {
          timestamp: 1,
          level: "error",
          messageKey: "messages.deviceDisconnected",
          detail: null,
        },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unknown session request kind", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-unknown",
      kind: "session-rm-rf",
      payload: {},
    });
    expect(result.ok).toBe(false);
  });

  it("round-trips a Result<number> payload", () => {
    const restored = fromResultPayload(toResultPayload(ok(1234)));
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.value).toBe(1234);

    const failed = createMamepError({
      code: "REQUEST_TIMEOUT",
      category: "timeout",
      retryable: true,
      userMessageKey: "errors.requestTimeout",
      technicalMessage: "timeout",
    });
    const restoredFail = fromResultPayload(toResultPayload(fail(failed)));
    expect(restoredFail.ok).toBe(false);
    if (!restoredFail.ok) expect(restoredFail.error.code).toBe("REQUEST_TIMEOUT");
  });
});

describe("host-message TCP session kinds（2026-08-23 两端 TCP 接线）", () => {
  const tcpProfile = {
    id: "conn-tcp-1",
    name: "PLC",
    protocol: "tcp",
    host: "192.168.1.10",
    port: 502,
    unitId: 0,
    connectTimeoutMs: 5000,
    requestTimeoutMs: 1000,
    retryCount: 1,
    autoReconnect: false,
    interRequestDelayMs: 50,
  };

  it("accepts a valid session-tcp-connect request", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-tcp-connect",
      kind: "session-tcp-connect",
      payload: { profile: tcpProfile },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects session-tcp-connect with an RTU profile", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-tcp-connect-bad",
      kind: "session-tcp-connect",
      payload: {
        profile: { ...tcpProfile, protocol: "rtu" },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects session-tcp-connect with missing host", () => {
    const { host, ...noHost } = tcpProfile;
    expect(typeof host).toBe("string");
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-tcp-connect-nohost",
      kind: "session-tcp-connect",
      payload: { profile: noHost },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a valid session-set-unit-id request（TCP Unit ID 会话内动态修改，2026-08-25）", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-set-unit-id",
      kind: "session-set-unit-id",
      payload: { unitId: 9 },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "request") {
      expect(result.value.payload).toEqual({ unitId: 9 });
    }
  });

  it("rejects session-set-unit-id with missing unitId", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-set-unit-id-bad",
      kind: "session-set-unit-id",
      payload: {},
    });
    expect(result.ok).toBe(false);
  });
});

describe("host-message save-text-file kind（2026-08-28 通信日志 CSV 导出）", () => {
  it("accepts a valid save-text-file request", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-export",
      kind: "save-text-file",
      payload: {
        suggestedName: "comm-log-rtu-20260828-102030.csv",
        content: "seq,timestamp\r\n1,2026-08-28T10:20:30.123+08:00\r\n",
        mimeType: "text/csv",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "request") {
      expect(result.value.kind).toBe("save-text-file");
    }
  });

  it("accepts a save-text-file request without mimeType", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-export-2",
      kind: "save-text-file",
      payload: { suggestedName: "a.csv", content: "x" },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a save-text-file request with an empty suggestedName", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-export-bad",
      kind: "save-text-file",
      payload: { suggestedName: "", content: "x" },
    });
    expect(result.ok).toBe(false);
  });

  it("validates a saved response via saveTextFileResponseSchema", () => {
    const parsed = saveTextFileResponseSchema.safeParse({
      saved: true,
      filePath: "C:\\logs\\comm-log.csv",
    });
    expect(parsed.success).toBe(true);
  });

  it("validates a cancelled (not saved) response", () => {
    const parsed = saveTextFileResponseSchema.safeParse({
      saved: false,
      filePath: null,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("host-message open-text-file kind（2026-08-29 工作区导入）", () => {
  it("accepts an open-text-file request without payload options", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-open-1",
      kind: "open-text-file",
      payload: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "request") {
      expect(result.value.kind).toBe("open-text-file");
    }
  });

  it("accepts an open-text-file request with suggestedName", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-open-2",
      kind: "open-text-file",
      payload: { suggestedName: "mamep-workspace.json" },
    });
    expect(result.ok).toBe(true);
  });

  it("strips unknown payload keys (non-strict Zod, consistent with other kinds)", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-open-3",
      kind: "open-text-file",
      payload: { path: "C:\\secret\\workspace.json" },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "request") {
      expect(result.value.payload).toEqual({});
    }
  });

  it("validates a content response via openTextFileResponseSchema", () => {
    const parsed = openTextFileResponseSchema.safeParse({
      content: '{"schemaVersion":4}',
    });
    expect(parsed.success).toBe(true);
  });

  it("validates a cancelled (content null) response as non-error", () => {
    const parsed = openTextFileResponseSchema.safeParse({ content: null });
    expect(parsed.success).toBe(true);
  });
});

describe("host-message workspace kinds（2026-08-30，ADR-036 Electron 文件持久化）", () => {
  it("accepts a workspace-load request with empty payload", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-ws-load-1",
      kind: "workspace-load",
      payload: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "request") {
      expect(result.value.kind).toBe("workspace-load");
    }
  });

  it("accepts a workspace-save request with serialized JSON content", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-ws-save-1",
      kind: "workspace-save",
      payload: { content: '{"schemaVersion":4}' },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a workspace-save request without content", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-ws-save-2",
      kind: "workspace-save",
      payload: {},
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a workspace-save request with non-string content", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-ws-save-3",
      kind: "workspace-save",
      payload: { content: 42 },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a workspace-clear request with empty payload", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-ws-clear-1",
      kind: "workspace-clear",
      payload: {},
    });
    expect(result.ok).toBe(true);
  });

  it("validates a content response via workspaceLoadResponseSchema", () => {
    const parsed = workspaceLoadResponseSchema.safeParse({
      content: '{"schemaVersion":4}',
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a workspaceLoad response without content", () => {
    const parsed = workspaceLoadResponseSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });
});

describe("host-message plugin-store kinds（2026-08-30，ADR-038 插件安装入口）", () => {
  const manifestPayload = {
    id: "installed-a",
    name: "Installed A",
    version: "1.0.0",
    description: "A user-installed plugin",
    platform: { web: true, node: false },
    permissions: ["ui.panel"],
    contributions: { panels: [] },
  };

  it("accepts a plugin-store-load request with empty payload", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-plugin-load-1",
      kind: "plugin-store-load",
      payload: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "request") {
      expect(result.value.kind).toBe("plugin-store-load");
    }
  });

  it("accepts a plugin-store-save request with store data payload", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-plugin-save-1",
      kind: "plugin-store-save",
      payload: {
        data: {
          schemaVersion: 1,
          plugins: [{ manifest: manifestPayload, enabled: true }],
        },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a plugin-store-save request without data", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-plugin-save-2",
      kind: "plugin-store-save",
      payload: {},
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a plugin-store-save request with invalid manifest", () => {
    const result = parseHostMessage({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId: "req-plugin-save-3",
      kind: "plugin-store-save",
      payload: {
        data: {
          schemaVersion: 1,
          plugins: [{ manifest: { id: "x" }, enabled: true }],
        },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("validates a plugin store data response via pluginStoreDataResponseSchema", () => {
    const parsed = pluginStoreDataResponseSchema.safeParse({
      schemaVersion: 1,
      plugins: [{ manifest: manifestPayload, enabled: false }],
    });
    expect(parsed.success).toBe(true);
  });
});
