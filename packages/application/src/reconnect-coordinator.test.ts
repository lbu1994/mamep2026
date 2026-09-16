/**
 * ReconnectCoordinator 单测（packages/application，Application 层）。
 * 覆盖：armed/disarm 触发条件、指数退避重连成功、失败达上限转 failed 并上报消息、
 * 用户断开/新连接取消挂起重连、退避间隔序列、autoReconnect=false 不触发。
 * 计时用 VirtualClock，openTransport/performReconnect 注入 mock。
 */
import { describe, expect, it, vi } from "vitest";
import { ReconnectCoordinator } from "./reconnect-coordinator";
import type { SessionHostEvents } from "./session-host-core";
import type {
  CommunicationLogEvent,
  ConnectionState,
  TraceSample,
  TransportPort,
} from "@mamep2026/communication";
import {
  createDefaultTcpProfile,
  createMamepError,
  fail,
  ok,
  type Result,
  type TcpConnectionProfile,
} from "@mamep2026/domain";
import type { ApplicationMessage } from "@mamep2026/logging";
import { FakeTransport, VirtualClock } from "@mamep2026/test-kit";

type MockedEvent = ReturnType<typeof vi.fn>;

interface Harness {
  coordinator: ReconnectCoordinator;
  clock: VirtualClock;
  states: ConnectionState[];
  messages: ApplicationMessage[];
  openTransport: ReturnType<typeof vi.fn>;
  performReconnect: ReturnType<typeof vi.fn>;
  profile: TcpConnectionProfile;
}

function failResult(): Result<TransportPort> {
  return fail(
    createMamepError({
      code: "TCP_CONNECT_FAILED",
      category: "connection",
      severity: "error",
      retryable: true,
      userMessageKey: "errors.tcpConnectFailed",
      technicalMessage: "open failed (fake)",
    }),
  );
}

function createHarness(
  options: {
    autoReconnect?: boolean;
    maxAttempts?: number;
    baseIntervalMs?: number;
    maxIntervalMs?: number;
  } = {},
): Harness {
  const clock = new VirtualClock();
  const states: ConnectionState[] = [];
  const messages: ApplicationMessage[] = [];
  const events: Record<keyof SessionHostEvents, MockedEvent> = {
    onLog: vi.fn<(event: CommunicationLogEvent) => void>(),
    onStateChange: vi.fn<(state: ConnectionState) => void>((state) =>
      states.push(state),
    ),
    onPollResult: vi.fn(),
    onTraceSample: vi.fn<(sample: TraceSample) => void>(),
    onMessage: vi.fn<(message: ApplicationMessage) => void>((message) =>
      messages.push(message),
    ),
  };
  const transport = new FakeTransport();
  const openTransport = vi.fn(async (): Promise<Result<TransportPort>> =>
    ok(transport),
  );
  const performReconnect = vi.fn(async (): Promise<Result<void>> =>
    ok(undefined),
  );
  const profile = createDefaultTcpProfile("PLC");
  profile.autoReconnect = options.autoReconnect ?? true;
  const coordinator = new ReconnectCoordinator({
    clock,
    events: events as SessionHostEvents,
    openTransport,
    performReconnect,
    maxAttempts: options.maxAttempts ?? 5,
    baseIntervalMs: options.baseIntervalMs ?? 1000,
    maxIntervalMs: options.maxIntervalMs ?? 15000,
  });
  return {
    coordinator,
    clock,
    states,
    messages,
    openTransport,
    performReconnect,
    profile,
  };
}

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe("ReconnectCoordinator 触发条件", () => {
  it("autoReconnect=false 时 interrupted 不触发重连", () => {
    const h = createHarness({ autoReconnect: false });
    h.coordinator.arm(h.profile);
    h.coordinator.onSessionState("interrupted");
    expect(h.states).toEqual([]);
    expect(h.openTransport).not.toHaveBeenCalled();
    expect(h.coordinator.getState()).toBeNull();
  });

  it("未 arm（未连接成功）时 interrupted 不触发重连", () => {
    const h = createHarness();
    h.coordinator.onSessionState("interrupted");
    expect(h.openTransport).not.toHaveBeenCalled();
    expect(h.coordinator.getState()).toBeNull();
  });

  it("非 interrupted 状态不触发重连", () => {
    const h = createHarness();
    h.coordinator.arm(h.profile);
    h.coordinator.onSessionState("failed");
    h.coordinator.onSessionState("disconnected");
    expect(h.openTransport).not.toHaveBeenCalled();
  });
});

describe("ReconnectCoordinator 重连成功", () => {
  it("interrupted 后按退避重连成功：状态序列 + 无失败消息", async () => {
    const h = createHarness();
    h.coordinator.arm(h.profile);
    h.coordinator.onSessionState("interrupted");
    expect(h.states).toEqual(["reconnect-waiting"]);

    h.clock.advance(1000);
    await flushMicrotasks();
    expect(h.states).toEqual(["reconnect-waiting", "reconnecting"]);
    expect(h.openTransport).toHaveBeenCalledTimes(1);
    expect(h.performReconnect).toHaveBeenCalledTimes(1);
    // 成功：状态回 null（宿主回退会话状态 connected）。
    expect(h.coordinator.getState()).toBeNull();
    expect(h.messages).toEqual([]);
  });

  it("open 首次失败后继续退避重试，第二次成功", async () => {
    const h = createHarness();
    h.openTransport
      .mockResolvedValueOnce(failResult())
      .mockResolvedValueOnce(ok(new FakeTransport()));
    h.coordinator.arm(h.profile);
    h.coordinator.onSessionState("interrupted");

    // attempt1：等待 1000 → open 失败 → attempt2（reconnect-waiting 再次）。
    h.clock.advance(1000);
    await flushMicrotasks();
    expect(h.openTransport).toHaveBeenCalledTimes(1);
    expect(h.states).toEqual([
      "reconnect-waiting",
      "reconnecting",
      "reconnect-waiting",
    ]);

    // attempt2：等待 2000 → open 成功 → performReconnect 成功。
    h.clock.advance(2000);
    await flushMicrotasks();
    expect(h.openTransport).toHaveBeenCalledTimes(2);
    expect(h.performReconnect).toHaveBeenCalledTimes(1);
    expect(h.coordinator.getState()).toBeNull();
    expect(h.messages).toEqual([]);
  });

  it("performReconnect 失败后继续尝试，最终成功", async () => {
    const h = createHarness();
    h.performReconnect
      .mockResolvedValueOnce(
        fail(
          createMamepError({
            code: "TCP_CONNECT_FAILED",
            category: "connection",
            severity: "error",
            retryable: true,
            userMessageKey: "errors.tcpConnectFailed",
            technicalMessage: "connect failed (fake)",
          }),
        ),
      )
      .mockResolvedValueOnce(ok(undefined));
    h.coordinator.arm(h.profile);
    h.coordinator.onSessionState("interrupted");

    h.clock.advance(1000);
    await flushMicrotasks();
    expect(h.performReconnect).toHaveBeenCalledTimes(1);

    h.clock.advance(2000);
    await flushMicrotasks();
    expect(h.performReconnect).toHaveBeenCalledTimes(2);
    expect(h.coordinator.getState()).toBeNull();
    expect(h.messages).toEqual([]);
  });
});

describe("ReconnectCoordinator 失败达上限", () => {
  it("open 持续失败达到 maxAttempts：转 failed 并上报 messages.reconnectFailed", async () => {
    const h = createHarness({ maxAttempts: 3, baseIntervalMs: 100 });
    h.openTransport.mockImplementation(
      async (): Promise<Result<TransportPort>> => failResult(),
    );
    h.coordinator.arm(h.profile);
    h.coordinator.onSessionState("interrupted");

    // attempt1: wait 100
    h.clock.advance(100);
    await flushMicrotasks();
    expect(h.openTransport).toHaveBeenCalledTimes(1);
    // attempt2: wait 200
    h.clock.advance(200);
    await flushMicrotasks();
    expect(h.openTransport).toHaveBeenCalledTimes(2);
    // attempt3: wait 400 → attempt4 > maxAttempts → failed
    h.clock.advance(400);
    await flushMicrotasks();
    expect(h.openTransport).toHaveBeenCalledTimes(3);
    expect(h.coordinator.getState()).toBe("failed");
    expect(h.states[h.states.length - 1]).toBe("failed");
    expect(
      h.messages.some((m) => m.messageKey === "messages.reconnectFailed"),
    ).toBe(true);
  });

  it("退避间隔序列：base*2^(n-1) 封顶 maxIntervalMs", async () => {
    const h = createHarness({
      maxAttempts: 6,
      baseIntervalMs: 100,
      maxIntervalMs: 500,
    });
    h.openTransport.mockImplementation(
      async (): Promise<Result<TransportPort>> => failResult(),
    );
    h.coordinator.arm(h.profile);
    h.coordinator.onSessionState("interrupted");

    // attempt1-5 等待 100/200/400/500(cap)/500(cap)，attempt6 后 attempt7>6 → failed。
    const delays = [100, 200, 400, 500, 500, 500];
    for (const delay of delays) {
      h.clock.advance(delay);
      await flushMicrotasks();
    }
    expect(h.openTransport).toHaveBeenCalledTimes(6);
    expect(h.coordinator.getState()).toBe("failed");
  });
});

describe("ReconnectCoordinator 取消语义", () => {
  it("disarm 取消挂起重连：不再 openTransport", async () => {
    const h = createHarness();
    h.coordinator.arm(h.profile);
    h.coordinator.onSessionState("interrupted");
    expect(h.states).toEqual(["reconnect-waiting"]);

    h.coordinator.disarm();
    h.clock.advance(10000);
    await flushMicrotasks();
    expect(h.openTransport).not.toHaveBeenCalled();
    expect(h.states).toEqual(["reconnect-waiting"]);
    expect(h.coordinator.getState()).toBeNull();
  });

  it("等待期间重新 arm（新连接成功）取消旧重连循环", async () => {
    const h = createHarness();
    h.coordinator.arm(h.profile);
    h.coordinator.onSessionState("interrupted");

    h.coordinator.arm(h.profile);
    h.clock.advance(10000);
    await flushMicrotasks();
    expect(h.openTransport).not.toHaveBeenCalled();
    expect(h.coordinator.getState()).toBeNull();
  });
});
