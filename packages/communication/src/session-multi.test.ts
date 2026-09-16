import { describe, expect, it } from "vitest";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import { appendCrc } from "@mamep2026/protocol-modbus";
import { CommunicationSession } from "./session";
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

function readResponseMulti(slave: number, values: number[]): Uint8Array {
  const payload = new Uint8Array(3 + values.length * 2);
  payload[0] = slave;
  payload[1] = 0x03;
  payload[2] = values.length * 2;
  values.forEach((value, index) => {
    payload[3 + index * 2] = (value >> 8) & 0xff;
    payload[4 + index * 2] = value & 0xff;
  });
  return appendCrc(payload);
}

function writeResponseMulti(
  slave: number,
  address: number,
  quantity: number,
): Uint8Array {
  return appendCrc(
    Uint8Array.from([
      slave,
      0x10,
      (address >> 8) & 0xff,
      address & 0xff,
      (quantity >> 8) & 0xff,
      quantity & 0xff,
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

describe("CommunicationSession 多寄存器读写（ADR-030）", () => {
  it("readRegisters：一次 FC03 读 quantity 个连续寄存器", async () => {
    const { clock, transport, session } = makeSession();
    await session.connect();
    const promise = session.readRegisters(0x1000, 2, {
      source: "manual-read",
      userAddress: 0x1000,
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    // 请求帧：FC03 + quantity=2。
    const frame = transport.sentFrames[0] ?? new Uint8Array(0);
    expect(frame[1]).toBe(0x03);
    expect(((frame[4] ?? 0) << 8) | (frame[5] ?? 0)).toBe(2);
    transport.simulateData(readResponseMulti(1, [0x1234, 0xabcd]));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([0x1234, 0xabcd]);
  });

  it("readRegisters：quantity 超上限（>125）拒绝", async () => {
    const { session } = makeSession();
    await session.connect();
    const result = await session.readRegisters(0x1000, 126, {
      source: "manual-read",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("QUANTITY_OUT_OF_RANGE");
  });

  it("readRegisters：quantity 非正数拒绝", async () => {
    const { session } = makeSession();
    await session.connect();
    const result = await session.readRegisters(0x1000, 0, {
      source: "manual-read",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("QUANTITY_OUT_OF_RANGE");
  });

  it("writeRegisters：一次 FC0x10 写多个寄存器", async () => {
    const { clock, transport, session } = makeSession();
    await session.connect();
    const promise = session.writeRegisters(0x1000, [0x1234, 0xabcd], {
      source: "manual-write",
      userAddress: 0x1000,
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    // 请求帧：FC10 + quantity=2 + byteCount=4 + 值大端。
    const frame = transport.sentFrames[0] ?? new Uint8Array(0);
    expect(frame[1]).toBe(0x10);
    expect(((frame[4] ?? 0) << 8) | (frame[5] ?? 0)).toBe(2);
    expect(frame[6]).toBe(4);
    expect(frame[7]).toBe(0x12);
    expect(frame[9]).toBe(0xab);
    expect(frame[10]).toBe(0xcd);
    transport.simulateData(writeResponseMulti(1, 0x1000, 2));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value).toEqual({ kind: "write-succeeded-no-verify" });
  });

  it("writeRegisters：values 超上限（>123）拒绝", async () => {
    const { session } = makeSession();
    await session.connect();
    const result = await session.writeRegisters(0x1000, Array(124).fill(0), {
      source: "manual-write",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("QUANTITY_OUT_OF_RANGE");
  });

  it("writeRegisters 多值异常响应 → MODBUS_EXCEPTION", async () => {
    const { clock, transport, session } = makeSession();
    await session.connect();
    const promise = session.writeRegisters(0x1000, [0x1234, 0xabcd], {
      source: "manual-write",
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(exceptionResponse(1, 0x10, 0x02));
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MODBUS_EXCEPTION_02");
  });

  it("readRegister 单值包装（quantity=1）行为不变", async () => {
    const { clock, transport, session } = makeSession();
    await session.connect();
    const promise = session.readRegister(0x1000, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(readResponseMulti(1, [0x1234]));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x1234);
  });
});
