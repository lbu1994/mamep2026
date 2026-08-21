/**
 * 跨边界消息协议 v1 校验测试（docs/AGENTS.md §23）。
 */
import { describe, expect, it } from "vitest";
import {
  HOST_MESSAGE_PROTOCOL_VERSION,
  MAMEP_IPC_EVENT_CHANNEL,
  MAMEP_IPC_INVOKE_CHANNEL,
  fromErrorPayload,
  parseHostMessage,
  toErrorPayload,
} from "./host-message";
import { createMamepError } from "@mamep2026/domain";

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
