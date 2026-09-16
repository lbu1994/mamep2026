import { describe, expect, it } from "vitest";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import { appendCrc } from "@mamep2026/protocol-modbus";
import { CommunicationSession } from "./session";
import { PollingCoordinator } from "./polling-coordinator";
import { FakeTransport } from "./testing/fake-transport";
import { ManualClock, advanceUntil } from "./testing/manual-clock";

function setup() {
  const clock = new ManualClock();
  const transport = new FakeTransport();
  const profile = createDefaultRtuProfile();
  // 默认超时已改为 50ms（2026-09-06）：调度断言依赖请求在观察窗口内保持 in-flight，
  // 显式放宽超时防止 in-flight 请求提前超时触发新一轮轮询。
  profile.requestTimeoutMs = 1000;
  const session = new CommunicationSession({
    transport,
    clock,
    config: profile,
  });
  return { clock, transport, session };
}

async function connect(session: CommunicationSession): Promise<void> {
  await session.connect();
}

function readResponse(slave: number, value: number): Uint8Array {
  return appendCrc(
    Uint8Array.from([slave, 0x03, 0x02, (value >> 8) & 0xff, value & 0xff]),
  );
}

describe("PollingCoordinator", () => {
  it("polls each target through the session", async () => {
    const { clock, transport, session } = setup();
    await connect(session);
    const coordinator = new PollingCoordinator(session, clock, {
      getIntervalMs: () => 50,
    });
    coordinator.setTargets([
      { key: "a", address: 0x0001 },
      { key: "b", address: 0x0002 },
    ]);

    const results: Array<{ key: string; value: number }> = [];
    coordinator.onResult((key, _address, result) => {
      if (result.ok)
        results.push({
          key,
          value: Array.isArray(result.value)
            ? (result.value[0] ?? 0)
            : result.value,
        });
    });

    coordinator.start();
    // 第一轮两个请求逐个执行（单并发），逐帧模拟响应。
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(readResponse(1, 0x11));
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    transport.simulateData(readResponse(1, 0x22));
    await advanceUntil(clock, () => results.length === 2);
    coordinator.stop();

    expect(results).toEqual([
      { key: "a", value: 0x11 },
      { key: "b", value: 0x22 },
    ]);
    expect(transport.sentFrames[0]?.[3]).toBe(0x01);
    expect(transport.sentFrames[1]?.[3]).toBe(0x02);
  });

  it("does not pile up requests while a previous poll is still in flight", async () => {
    const { clock, transport, session } = setup();
    await connect(session);
    const coordinator = new PollingCoordinator(session, clock, {
      getIntervalMs: () => 50,
    });
    coordinator.setTargets([{ key: "a", address: 0x0001 }]);
    const results: number[] = [];
    coordinator.onResult((_key, _address, result) => {
      if (result.ok)
        results.push(
          Array.isArray(result.value) ? (result.value[0] ?? 0) : result.value,
        );
    });

    coordinator.start();
    // 第一轮请求发出后不响应，推进多个周期。
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    clock.advance(300);
    await Promise.resolve();
    // 请求未完成期间不得积压新请求。
    expect(transport.sentFrames.length).toBe(1);

    transport.simulateData(readResponse(1, 0x55));
    await advanceUntil(clock, () => results.length === 1);
    coordinator.stop();
  });

  it("stops scheduling after stop()", async () => {
    const { clock, transport, session } = setup();
    await connect(session);
    const coordinator = new PollingCoordinator(session, clock, {
      getIntervalMs: () => 50,
    });
    coordinator.setTargets([{ key: "a", address: 0x0001 }]);
    coordinator.start();
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    coordinator.stop();
    const countAtStop = transport.sentFrames.length;
    clock.advance(500);
    await Promise.resolve();
    expect(transport.sentFrames.length).toBe(countAtStop);
  });

  it("stops polling for removed targets", async () => {
    const { clock, transport, session } = setup();
    await connect(session);
    const coordinator = new PollingCoordinator(session, clock, {
      getIntervalMs: () => 50,
    });
    coordinator.setTargets([
      { key: "a", address: 0x0001 },
      { key: "b", address: 0x0002 },
    ]);
    coordinator.start();
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(readResponse(1, 1));
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    transport.simulateData(readResponse(1, 2));

    coordinator.setTargets([{ key: "a", address: 0x0001 }]);
    // 清空已发送计数，后续只应轮询 a。
    transport.sentFrames = [];
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(readResponse(1, 3));
    coordinator.stop();

    const addresses = transport.sentFrames.map((f) => f[3]);
    expect(addresses).toEqual([0x01]);
  });

  it("defer 暂缓指定 key 的轮询、resume 恢复（§18.3 写入+回读期间）", async () => {
    const { clock, transport, session } = setup();
    await connect(session);
    const coordinator = new PollingCoordinator(session, clock, {
      getIntervalMs: () => 50,
    });
    coordinator.setTargets([{ key: "a", address: 0x0001 }]);
    const results: number[] = [];
    coordinator.onResult((_key, _address, result) => {
      if (result.ok)
        results.push(
          Array.isArray(result.value) ? (result.value[0] ?? 0) : result.value,
        );
    });

    coordinator.start();
    // 第一轮正常轮询。
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(readResponse(1, 1));
    await advanceUntil(clock, () => results.length === 1);

    // 暂缓 a：推进多个周期，不得发出 a 的请求（幂等）。
    coordinator.defer("a");
    coordinator.defer("a");
    const countAtDefer = transport.sentFrames.length;
    clock.advance(300);
    await Promise.resolve();
    expect(transport.sentFrames.length).toBe(countAtDefer);

    // 恢复 a：下一周期恢复轮询。
    coordinator.resume("a");
    await advanceUntil(
      clock,
      () => transport.sentFrames.length === countAtDefer + 1,
    );
    transport.simulateData(readResponse(1, 2));
    await advanceUntil(clock, () => results.length === 2);
    coordinator.stop();
    expect(results).toEqual([1, 2]);
  });
});
