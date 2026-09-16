/**
 * 后台挂起/恢复（移动端生命周期，ADR-050 Phase 3）单测。
 *
 * 语义：进后台暂停轮询与追踪（**配置保留**），回前台按原配置恢复；幂等；离线时恢复不启动。
 * 复用 RtuSessionHost + FakeTransport + ScriptedModbusRtuDevice + VirtualClock（与既有宿主测试同源）。
 */
import { describe, expect, it, vi } from "vitest";
import type {
  CommunicationLogEvent,
  ConnectionState,
  TraceSample,
} from "@mamep2026/communication";
import { createDefaultRtuProfile, type Result } from "@mamep2026/domain";
import type { ApplicationMessage } from "@mamep2026/logging";
import {
  FakeTransport,
  ScriptedModbusRtuDevice,
  VirtualClock,
} from "@mamep2026/test-kit";
import { RtuSessionHost, type RtuSessionHostEvents } from "./rtu-session-host";

type MockedEvent = ReturnType<typeof vi.fn>;

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

function createHarness() {
  const clock = new VirtualClock();
  const device = new ScriptedModbusRtuDevice();
  const transport = new FakeTransport();
  transport.device = device;
  const events: Record<keyof RtuSessionHostEvents, MockedEvent> = {
    onLog: vi.fn<(event: CommunicationLogEvent) => void>(),
    onStateChange: vi.fn<(state: ConnectionState) => void>(),
    onPollResult:
      vi.fn<
        (
          key: string,
          address: number,
          result: Result<number | number[]>,
        ) => void
      >(),
    onTraceSample: vi.fn<(sample: TraceSample) => void>(),
    onMessage: vi.fn<(message: ApplicationMessage) => void>(),
  };
  const host = new RtuSessionHost({
    clock,
    events: events as unknown as RtuSessionHostEvents,
  });
  return { host, clock, transport, device, events };
}

async function connect(h: ReturnType<typeof createHarness>): Promise<void> {
  const result = await h.host.connect({
    profile: createDefaultRtuProfile(),
    transport: h.transport,
    slaveAddress: 1,
    portLabel: "COM4",
  });
  expect(result.ok).toBe(true);
}

describe("SessionHostCore 后台挂起/恢复（ADR-050 Phase 3）", () => {
  it("挂起后停止轮询：不再产生轮询结果", async () => {
    const h = createHarness();
    await connect(h);
    h.device.setRegister(0x2000, 0x1234);
    h.host.updatePollingTargets([{ key: "row-a", address: 0x2000 }]);
    h.clock.advance(100);
    await flushMicrotasks();
    expect(h.events.onPollResult).toHaveBeenCalled();

    h.host.pauseBackground();
    expect(h.host.isBackgroundSuspended()).toBe(true);
    h.events.onPollResult.mockClear();

    h.clock.advance(500);
    await flushMicrotasks();
    expect(h.events.onPollResult).not.toHaveBeenCalled();
  });

  it("回前台按原配置恢复轮询（不必重新 updatePollingTargets）", async () => {
    const h = createHarness();
    await connect(h);
    h.device.setRegister(0x2000, 0xabcd);
    h.host.updatePollingTargets([{ key: "row-a", address: 0x2000 }]);
    h.host.pauseBackground();

    h.host.resumeBackground();
    expect(h.host.isBackgroundSuspended()).toBe(false);
    h.clock.advance(100);
    await flushMicrotasks();
    expect(h.events.onPollResult).toHaveBeenCalledWith(
      "row-a",
      0x2000,
      expect.objectContaining({ ok: true, value: 0xabcd }),
    );
  });

  it("挂起期间停止追踪，恢复后按原配置重启（保留 activeTraces）", async () => {
    const h = createHarness();
    await connect(h);
    h.device.setRegister(0x2000, 0x0001);
    h.host.traceStart("row-a", 0x2000, 50);
    h.clock.advance(120);
    await flushMicrotasks();
    expect(h.events.onTraceSample).toHaveBeenCalled();

    h.host.pauseBackground();
    h.events.onTraceSample.mockClear();
    h.clock.advance(300);
    await flushMicrotasks();
    expect(h.events.onTraceSample).not.toHaveBeenCalled();

    h.host.resumeBackground();
    h.clock.advance(120);
    await flushMicrotasks();
    expect(h.events.onTraceSample).toHaveBeenCalled();
  });

  it("幂等：重复挂起/重复恢复无副作用", async () => {
    const h = createHarness();
    await connect(h);
    h.host.updatePollingTargets([{ key: "row-a", address: 0x2000 }]);

    h.host.pauseBackground();
    h.host.pauseBackground();
    expect(h.host.isBackgroundSuspended()).toBe(true);

    h.host.resumeBackground();
    h.host.resumeBackground();
    expect(h.host.isBackgroundSuspended()).toBe(false);
  });

  it("挂起期间 updatePollingTargets 不启动轮询（回前台后恢复正常）", async () => {
    const h = createHarness();
    await connect(h);
    h.host.pauseBackground();
    h.host.updatePollingTargets([{ key: "row-a", address: 0x2000 }]);

    h.clock.advance(300);
    await flushMicrotasks();
    expect(h.events.onPollResult).not.toHaveBeenCalled();

    h.host.resumeBackground();
    h.clock.advance(100);
    await flushMicrotasks();
    expect(h.events.onPollResult).toHaveBeenCalled();
  });

  it("离线（未连接）时恢复不启动轮询，也不报错", async () => {
    const h = createHarness();
    h.host.updatePollingTargets([{ key: "row-a", address: 0x2000 }]);
    h.host.pauseBackground();
    h.host.resumeBackground();

    h.clock.advance(300);
    await flushMicrotasks();
    expect(h.events.onPollResult).not.toHaveBeenCalled();
  });
});
