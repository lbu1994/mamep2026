/**
 * SessionHostCore codec 注册表注入测试。
 *  宿主据此构建 codec 会话；核心仅透传，协议无关。
 */
import { describe, expect, it, vi } from "vitest";
import { SessionHostCore, type SessionHostEvents } from "./session-host-core";
import { createCodecRegistry } from "@mamep2026/communication";
import { VirtualClock } from "@mamep2026/test-kit";

function makeEvents(): SessionHostEvents {
  return {
    onLog: vi.fn(),
    onStateChange: vi.fn(),
    onPollResult: vi.fn(),
    onTraceSample: vi.fn(),
    onMessage: vi.fn(),
  };
}

describe("SessionHostCore codec 注册表（ADR-040 决策 5）", () => {
  it("stores and exposes the injected codecRegistry", () => {
    const registry = createCodecRegistry();
    const core = new SessionHostCore({
      clock: new VirtualClock(),
      events: makeEvents(),
      getPollingIntervalMs: () => 50,
      codecRegistry: registry,
    });
    expect(core.getCodecRegistry()).toBe(registry);
  });

  it("returns null when no codecRegistry is injected", () => {
    const core = new SessionHostCore({
      clock: new VirtualClock(),
      events: makeEvents(),
      getPollingIntervalMs: () => 50,
    });
    expect(core.getCodecRegistry()).toBeNull();
  });
});
