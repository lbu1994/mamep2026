import { describe, expect, it, vi } from "vitest";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import { appendCrc } from "@mamep2026/protocol-modbus";
import { BatchReadCoordinator } from "./batch-read-coordinator";
import { CommunicationSession } from "./session";
import { TraceCoordinator } from "./trace-coordinator";
import { FakeTransport } from "./testing/fake-transport";
import { ManualClock, advanceUntil } from "./testing/manual-clock";

function readResponse(slave: number, value: number): Uint8Array {
  return appendCrc(
    Uint8Array.from([slave, 0x03, 0x02, (value >> 8) & 0xff, value & 0xff]),
  );
}

describe("BatchReadCoordinator", () => {
  it("keeps the batch route snapshot even if the session target changes", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    const session = new CommunicationSession({
      transport,
      clock,
      config: createDefaultRtuProfile(),
      slaveAddress: 1,
    });
    await session.connect();
    const coordinator = new BatchReadCoordinator(session, clock);
    const handle = coordinator.readAll(
      [
        { key: "a", sheetId: "sheet-a", address: 0x0001 },
        { key: "b", sheetId: "sheet-a", address: 0x0002 },
      ],
      undefined,
      "batch-route",
      { unitAddress: 7, protocol: "rtu" },
    );

    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    session.setSlaveAddress(9);
    transport.simulateData(readResponse(7, 0x10));
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    expect(transport.sentFrames[0]?.[0]).toBe(7);
    expect(transport.sentFrames[1]?.[0]).toBe(7);
    transport.simulateData(readResponse(7, 0x20));
    expect((await handle.promise).ok).toBe(true);
  });

  it("reads each eligible row once and summarizes success/skipped counts", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    const session = new CommunicationSession({
      transport,
      clock,
      config: createDefaultRtuProfile(),
    });
    await session.connect();
    const coordinator = new BatchReadCoordinator(session, clock);

    const handle = coordinator.readAll([
      { key: "a", sheetId: "sheet-a", address: 0x0001 },
      { key: "b", sheetId: "sheet-a", address: 0x0002 },
      { key: "blank", sheetId: "sheet-a", address: null },
      { key: "c", sheetId: "sheet-a", address: 0x0003 },
    ]);

    // 单并发：逐帧模拟响应，避免后续响应被误判为迟到帧。
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(readResponse(1, 0x10));
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    transport.simulateData(readResponse(1, 0x20));
    await advanceUntil(clock, () => transport.sentFrames.length === 3);
    transport.simulateData(readResponse(1, 0x30));
    const result = await handle.promise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalRows).toBe(4);
      expect(result.value.eligibleRows).toBe(3);
      expect(result.value.successCount).toBe(3);
      expect(result.value.failureCount).toBe(0);
      expect(result.value.skippedCount).toBe(1);
    }
  });

  it("continues after a single row fails and counts the failure", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    const session = new CommunicationSession({
      transport,
      clock,
      config: createDefaultRtuProfile(),
    });
    await session.connect();
    const coordinator = new BatchReadCoordinator(session, clock);

    const handle = coordinator.readAll([
      { key: "a", sheetId: "sheet-a", address: 0x0001 },
      { key: "b", sheetId: "sheet-a", address: 0x0002 },
    ]);

    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    // a 回异常响应（失败）。
    transport.simulateData(appendCrc(Uint8Array.from([0x01, 0x83, 0x02])));
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    transport.simulateData(readResponse(1, 0x77));
    const result = await handle.promise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.successCount).toBe(1);
      expect(result.value.failureCount).toBe(1);
    }
  });

  it("uses the provided batchId in the summary (remote path, ADR-025)", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    const session = new CommunicationSession({
      transport,
      clock,
      config: createDefaultRtuProfile(),
    });
    await session.connect();
    const coordinator = new BatchReadCoordinator(session, clock);

    const handle = coordinator.readAll(
      [{ key: "a", sheetId: "sheet-a", address: 0x0001 }],
      undefined,
      "batch-xyz",
    );
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(readResponse(1, 0x10));
    const result = await handle.promise;

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.batchId).toBe("batch-xyz");
  });

  it("cancel() stops queued reads and counts them as cancelled (ADR-025)", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    const session = new CommunicationSession({
      transport,
      clock,
      config: createDefaultRtuProfile(),
    });
    await session.connect();
    const coordinator = new BatchReadCoordinator(session, clock);

    const handle = coordinator.readAll([
      { key: "a", sheetId: "sheet-a", address: 0x0001 },
      { key: "b", sheetId: "sheet-a", address: 0x0002 },
      { key: "c", sheetId: "sheet-a", address: 0x0003 },
    ]);
    // 第一行已发送（在飞）；其余排队未发送。
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    handle.cancel();
    transport.simulateData(readResponse(1, 0x10));
    const result = await handle.promise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalRows).toBe(3);
      // 在飞行完成（成功），排队行计为取消。
      expect(result.value.successCount).toBe(1);
      expect(result.value.cancelledCount).toBe(2);
    }
  });

  it("reports each row with its real address, sheet and captured route", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    const session = new CommunicationSession({
      transport,
      clock,
      config: createDefaultRtuProfile(),
    });
    await session.connect();
    const coordinator = new BatchReadCoordinator(session, clock);
    const events: Array<{
      key: string;
      sheetId: string;
      address: number;
      requestGeneration: number;
    }> = [];
    const handle = coordinator.readAll(
      [{ key: "a", sheetId: "sheet-a", address: 0x002a }],
      (event) => events.push(event),
      "batch-context",
      { unitAddress: 3, protocol: "rtu" },
      17,
    );

    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(readResponse(3, 0x1234));
    await handle.promise;

    expect(events).toEqual([
      {
        key: "a",
        sheetId: "sheet-a",
        address: 0x002a,
        route: { unitAddress: 3, protocol: "rtu" },
        requestGeneration: 17,
        result: { ok: true, value: 0x1234 },
      },
    ]);
  });
});

describe("TraceCoordinator", () => {
  it("retains all float64 words including a low bit lost by a combined Number", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    const session = new CommunicationSession({ transport, clock, config: createDefaultRtuProfile() });
    await session.connect();
    const coordinator = new TraceCoordinator(session, clock);
    const listener = vi.fn();
    coordinator.onSample(listener);
    coordinator.start("float-row", 100, 100, 4);
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(appendCrc(Uint8Array.from([1, 3, 8, 0x3f, 0xf0, 0, 0, 0, 0, 0, 1])));
    await advanceUntil(clock, () => listener.mock.calls.length === 1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ rawValues: [0x3ff0, 0, 0, 1], quantity: 4 }));
    coordinator.stopAll();
  });
  it("drops an old request after same-key restart and keeps the submitted identity", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    const session = new CommunicationSession({
      transport,
      clock,
      config: createDefaultRtuProfile(),
    });
    await session.connect();
    const submitted = vi.spyOn(session, "createReadRequest");
    const coordinator = new TraceCoordinator(session, clock);
    const listener = vi.fn();
    coordinator.onSample(listener);
    const route = { protocol: "rtu", unitAddress: 6 };
    coordinator.start("row", 1, 100, 1, route, {
      sheetId: "sheet-a",
      rowId: "row",
      generation: 10,
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    const oldContext = submitted.mock.results[0]?.value.context;
    coordinator.stop("row");
    coordinator.start("row", 2, 100, 1, route, {
      sheetId: "sheet-b",
      rowId: "row",
      generation: 11,
    });
    route.unitAddress = 9;
    transport.simulateData(readResponse(6, 111));
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    expect(listener).not.toHaveBeenCalled();
    const newContext = submitted.mock.results[1]?.value.context;
    expect(newContext.requestId).not.toBe(oldContext.requestId);
    expect(newContext.connectionId).toBe(oldContext.connectionId);
    transport.simulateData(readResponse(6, 222));
    await advanceUntil(clock, () => listener.mock.calls.length === 1);
    expect(listener).toHaveBeenCalledWith({
      ...newContext,
      key: "row",
      generation: 11,
      sequence: 1,
      rawValue: 222,
      rawValues: [222],
      timestamp: expect.any(Number),
    });
    expect(newContext.route).toEqual({ protocol: "rtu", unitAddress: 6 });
    expect(Object.isFrozen(newContext.route)).toBe(true);
    coordinator.stopAll();
  });

  it("cancels queued reads when stopped and does not publish failed reads", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    const profile = createDefaultRtuProfile();
    profile.requestTimeoutMs = 1000;
    profile.retryCount = 0;
    const session = new CommunicationSession({
      transport,
      clock,
      config: profile,
    });
    await session.connect();
    const blocker = session.readRegister(0, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    const coordinator = new TraceCoordinator(session, clock);
    const listener = vi.fn();
    coordinator.onSample(listener);
    coordinator.start("row", 1, 50);
    clock.advance(50);
    coordinator.stop("row");
    transport.simulateData(readResponse(1, 12));
    await blocker;
    clock.advance(100);
    await Promise.resolve();
    expect(transport.sentFrames).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();
    coordinator.start("row", 1, 50);
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    transport.simulateData(appendCrc(Uint8Array.from([1, 0x83, 2])));
    await advanceUntil(clock, () => transport.sentFrames.length === 3);
    expect(listener).not.toHaveBeenCalled();
    coordinator.stopAll();
    await session.disconnect();
  });

  it("samples using the route captured at trace start", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    const session = new CommunicationSession({
      transport,
      clock,
      config: createDefaultRtuProfile(),
      slaveAddress: 1,
    });
    await session.connect();
    const coordinator = new TraceCoordinator(session, clock);

    coordinator.start("t1", 0x0001, 100, 1, {
      unitAddress: 6,
      protocol: "rtu",
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    session.setSlaveAddress(9);
    expect(transport.sentFrames[0]?.[0]).toBe(6);
    transport.simulateData(readResponse(6, 0x1111));
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    expect(transport.sentFrames[1]?.[0]).toBe(6);
    coordinator.stop("t1");
    transport.simulateData(readResponse(6, 0x2222));
  });

  it("samples the target register at the configured speed with increasing sequence", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    const session = new CommunicationSession({
      transport,
      clock,
      config: createDefaultRtuProfile(),
    });
    await session.connect();
    const coordinator = new TraceCoordinator(session, clock);

    const samples: Array<{ sequence: number; rawValue: number }> = [];
    coordinator.onSample((sample) =>
      samples.push({ sequence: sample.sequence, rawValue: sample.rawValue }),
    );

    coordinator.start("t1", 0x0001, 100);
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(readResponse(1, 0x1111));
    await advanceUntil(clock, () => samples.length === 1);
    // 等待下一次采样请求。
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    transport.simulateData(readResponse(1, 0x2222));
    await advanceUntil(clock, () => samples.length === 2);
    coordinator.stop("t1");

    expect(samples[0]).toEqual({ sequence: 1, rawValue: 0x1111 });
    expect(samples[1]).toEqual({ sequence: 2, rawValue: 0x2222 });
  });

  it("stops sampling after stop()", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    const profile = createDefaultRtuProfile();
    // 默认超时为 50ms：stop() 后推进 500ms，需 in-flight 请求不提前超时
    // 干扰「停止调度」断言，显式放宽超时。
    profile.requestTimeoutMs = 1000;
    const session = new CommunicationSession({
      transport,
      clock,
      config: profile,
    });
    await session.connect();
    const coordinator = new TraceCoordinator(session, clock);

    coordinator.start("t1", 0x0001, 50);
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    coordinator.stop("t1");
    const count = transport.sentFrames.length;
    clock.advance(500);
    await Promise.resolve();
    expect(transport.sentFrames.length).toBe(count);
  });
});
