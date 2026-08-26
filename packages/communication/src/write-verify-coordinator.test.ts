import { describe, expect, it } from "vitest";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import { appendCrc } from "@mamep2026/protocol-modbus";
import { CommunicationSession } from "./session";
import { WriteVerifyCoordinator } from "./write-verify-coordinator";
import { createCancellationToken } from "./cancellation";
import { FakeTransport } from "./testing/fake-transport";
import { ManualClock, advanceUntil } from "./testing/manual-clock";

function makeSession() {
  const clock = new ManualClock();
  const transport = new FakeTransport();
  const session = new CommunicationSession({
    transport,
    clock,
    config: createDefaultRtuProfile(),
  });
  return { clock, transport, session };
}

function readResponse(slave: number, value: number): Uint8Array {
  return appendCrc(
    Uint8Array.from([slave, 0x03, 0x02, (value >> 8) & 0xff, value & 0xff]),
  );
}

function writeResponse(slave: number, address: number): Uint8Array {
  return appendCrc(
    Uint8Array.from([
      slave,
      0x10,
      (address >> 8) & 0xff,
      address & 0xff,
      0x00,
      0x01,
    ]),
  );
}

function exceptionResponse(
  slave: number,
  functionCode: number,
  code: number,
): Uint8Array {
  return appendCrc(Uint8Array.from([slave, functionCode | 0x80, code]));
}

/** 等待写入帧发出并回写响应。 */
async function completeWrite(
  clock: ManualClock,
  transport: FakeTransport,
  address: number,
): Promise<void> {
  await advanceUntil(clock, () => transport.sentFrames.length === 1);
  transport.simulateData(writeResponse(1, address));
  await Promise.resolve();
}

describe("WriteVerifyCoordinator 写后回读（§15.3 / §18.2）", () => {
  it("OFF：写入成功不回读，返回 write-succeeded-no-verify", async () => {
    const { clock, transport, session } = makeSession();
    await session.connect();
    const coordinator = new WriteVerifyCoordinator(session, clock);
    const promise = coordinator.writeWithVerify(
      0x0001,
      0x1234,
      { mode: "off", delayMs: null },
      { userAddress: 0x0001 },
    );
    await completeWrite(clock, transport, 0x0001);
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ kind: "write-succeeded-no-verify" });
    // 不回读：只发送了写入帧。
    expect(transport.sentFrames).toHaveLength(1);
  });

  it("ON：写入后立即回读，值一致 → write-succeeded-verify-matched", async () => {
    const { clock, transport, session } = makeSession();
    await session.connect();
    const coordinator = new WriteVerifyCoordinator(session, clock);
    const promise = coordinator.writeWithVerify(
      0x0001,
      0x1234,
      { mode: "immediate", delayMs: null },
      { userAddress: 0x0001 },
    );
    await completeWrite(clock, transport, 0x0001);
    // 立即回读：读帧随后发出。
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    transport.simulateData(readResponse(1, 0x1234));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        kind: "write-succeeded-verify-matched",
        readValue: 0x1234,
      });
    }
  });

  it("ON：回读值不一致 → write-succeeded-verify-mismatched", async () => {
    const { clock, transport, session } = makeSession();
    await session.connect();
    const coordinator = new WriteVerifyCoordinator(session, clock);
    const promise = coordinator.writeWithVerify(
      0x0001,
      0x1234,
      { mode: "immediate", delayMs: null },
      { userAddress: 0x0001 },
    );
    await completeWrite(clock, transport, 0x0001);
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    transport.simulateData(readResponse(1, 0x5678));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        kind: "write-succeeded-verify-mismatched",
        expectedValue: 0x1234,
        readValue: 0x5678,
      });
    }
  });

  it("ON 100 ms：延迟期满前不发出读帧，期满后回读", async () => {
    const { clock, transport, session } = makeSession();
    await session.connect();
    const coordinator = new WriteVerifyCoordinator(session, clock);
    const promise = coordinator.writeWithVerify(
      0x0001,
      0x1234,
      { mode: "delayed", delayMs: 100 },
      { userAddress: 0x0001 },
    );
    await completeWrite(clock, transport, 0x0001);
    // 延迟 100ms 未到：不发出读帧。
    clock.advance(60);
    await Promise.resolve();
    expect(transport.sentFrames).toHaveLength(1);
    // 期满后（含 Rx Delay）发出读帧。
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    transport.simulateData(readResponse(1, 0x1234));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        kind: "write-succeeded-verify-matched",
        readValue: 0x1234,
      });
    }
  });

  it("延迟期间取消 → cancelled-before-verify（写入已成功仅回读取消）", async () => {
    const { clock, transport, session } = makeSession();
    await session.connect();
    const coordinator = new WriteVerifyCoordinator(session, clock);
    const token = createCancellationToken();
    const promise = coordinator.writeWithVerify(
      0x0001,
      0x1234,
      { mode: "delayed", delayMs: 200 },
      { userAddress: 0x0001, cancelToken: token },
    );
    await completeWrite(clock, transport, 0x0001);
    // 延迟中取消：立即返回 cancelled-before-verify，不发出读帧。
    token.cancel("user-cancelled");
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: "cancelled-before-verify" });
    }
    expect(transport.sentFrames).toHaveLength(1);
  });

  it("回读失败（Modbus 异常）→ write-succeeded-verify-failed（写入成功结论不变）", async () => {
    const { clock, transport, session } = makeSession();
    await session.connect();
    const coordinator = new WriteVerifyCoordinator(session, clock);
    const promise = coordinator.writeWithVerify(
      0x0001,
      0x1234,
      { mode: "immediate", delayMs: null },
      { userAddress: 0x0001 },
    );
    await completeWrite(clock, transport, 0x0001);
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    // 回读异常响应：FC03|0x80=0x83，异常码 0x02。
    transport.simulateData(exceptionResponse(1, 0x03, 0x02));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        kind: "write-succeeded-verify-failed",
        errorCode: "MODBUS_EXCEPTION_02",
        userMessageKey: "errors.modbusException",
      });
    }
  });

  it("回读在途被 disconnect 取消 → cancelled-before-verify", async () => {
    const { clock, transport, session } = makeSession();
    await session.connect();
    const coordinator = new WriteVerifyCoordinator(session, clock);
    const promise = coordinator.writeWithVerify(
      0x0001,
      0x1234,
      { mode: "immediate", delayMs: null },
      { userAddress: 0x0001 },
    );
    await completeWrite(clock, transport, 0x0001);
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    transport.simulateClose();
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: "cancelled-before-verify" });
    }
  });

  it("写入失败（Modbus 异常）→ 直接返回失败，不回读", async () => {
    const { clock, transport, session } = makeSession();
    await session.connect();
    const coordinator = new WriteVerifyCoordinator(session, clock);
    const promise = coordinator.writeWithVerify(
      0x0001,
      0x1234,
      { mode: "immediate", delayMs: null },
      { userAddress: 0x0001 },
    );
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(exceptionResponse(1, 0x10, 0x02));
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MODBUS_EXCEPTION_02");
    expect(transport.sentFrames).toHaveLength(1);
  });
});
