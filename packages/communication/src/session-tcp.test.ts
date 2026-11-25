import { describe, expect, it, vi } from "vitest";
import type { TcpConnectionProfile } from "@mamep2026/domain";
import {
  encodeTcpReadHoldingRegistersRequest,
  encodeTcpWriteSingleRegisterRequest,
} from "@mamep2026/protocol-modbus";
import { CommunicationSession } from "./session";
import { createCancellationToken } from "./cancellation";
import type { CommunicationLogEvent } from "./log-event";
import { FakeTransport } from "./testing/fake-transport";
import { ManualClock, advanceUntil } from "./testing/manual-clock";

function tcpProfile(
  overrides?: Partial<TcpConnectionProfile>,
): TcpConnectionProfile {
  return {
    id: "conn-tcp" as TcpConnectionProfile["id"],
    name: "TCP",
    protocol: "tcp",
    host: "127.0.0.1",
    port: 502,
    unitId: 0,
    connectTimeoutMs: 5000,
    requestTimeoutMs: 1000,
    retryCount: 1,
    autoReconnect: false,
    ...overrides,
  };
}

function makeTcpSession(opts?: {
  profile?: TcpConnectionProfile;
  unitId?: number;
  onLog?: (e: CommunicationLogEvent) => void;
}) {
  const clock = new ManualClock();
  const transport = new FakeTransport();
  const profile = opts?.profile ?? tcpProfile();
  const session = new CommunicationSession({
    transport,
    clock,
    config: profile,
    protocol: "tcp",
    unitId: opts?.unitId ?? 0,
    ...(opts?.onLog !== undefined ? { onLog: opts.onLog } : {}),
  });
  return { clock, transport, session, profile };
}

/** 组 MBAP 帧（不含 CRC）。 */
function tcpFrame(tid: number, unitId: number, pdu: Uint8Array): Uint8Array {
  const length = 1 + pdu.length;
  const frame = new Uint8Array(6 + length);
  frame[0] = (tid >> 8) & 0xff;
  frame[1] = tid & 0xff;
  frame[4] = (length >> 8) & 0xff;
  frame[5] = length & 0xff;
  frame[6] = unitId;
  frame.set(pdu, 7);
  return frame;
}

function readResponse(tid: number, unitId: number, value: number): Uint8Array {
  return tcpFrame(
    tid,
    unitId,
    Uint8Array.from([0x03, 0x02, (value >> 8) & 0xff, value & 0xff]),
  );
}

function writeResponse(
  tid: number,
  unitId: number,
  address: number,
): Uint8Array {
  return tcpFrame(
    tid,
    unitId,
    Uint8Array.from([0x10, (address >> 8) & 0xff, address & 0xff, 0x00, 0x01]),
  );
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

describe("TCP core table routes", () => {
  const coil = { protocol: "modbus-basic-tables:coil", unitAddress: 7 };
  const input = {
    protocol: "modbus-basic-tables:input-register",
    unitAddress: 255,
  };

  it("wraps the shared 16-bit transaction sequence across basic and holding tables", async () => {
    const { session, transport } = makeTcpSession();
    const transactionIds: number[] = [];
    vi.spyOn(transport, "write").mockImplementation(async (request) => {
      const transactionId = ((request[0] ?? 0) << 8) | (request[1] ?? 0);
      transactionIds.push(transactionId);
      transport.simulateData(
        tcpFrame(
          transactionId,
          request[6] ?? 0,
          request[7] === 1
            ? Uint8Array.from([1, 1, 1])
            : Uint8Array.from([3, 2, 0, 1]),
        ),
      );
      return { ok: true, value: undefined };
    });
    await session.connect();
    for (let requestIndex = 0; requestIndex <= 0x10000; requestIndex++) {
      const result = await session.readRegister(0, {
        source: "manual-read",
        route:
          requestIndex % 2 === 0 ? coil : { protocol: "tcp", unitAddress: 1 },
      });
      if (!result.ok) throw result.error;
    }
    expect(transactionIds.slice(-3)).toEqual([65534, 65535, 0]);
    await session.disconnect();
  }, 10000);

  it("serializes mixed tables with one transaction sequence and captured Unit IDs", async () => {
    const { session, transport, clock } = makeTcpSession();
    await session.connect();
    const first = session.readRegisters(10, 9, {
      source: "manual-read",
      route: coil,
    });
    const second = session.readRegister(20, {
      source: "manual-read",
      route: input,
    });
    const third = session.readRegister(30, {
      source: "manual-read",
      route: { protocol: "tcp", unitAddress: 0 },
    });
    session.setUnitId(99);
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    expect([...(transport.sentFrames[0] ?? [])]).toEqual([
      0, 0, 0, 0, 0, 6, 7, 1, 0, 10, 0, 9,
    ]);
    transport.simulateData(tcpFrame(0, 7, Uint8Array.from([1, 2, 0x85, 1])));
    expect(await first).toEqual({
      ok: true,
      value: [1, 0, 1, 0, 0, 0, 0, 1, 1],
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    expect([...(transport.sentFrames[1] ?? [])]).toEqual([
      0, 1, 0, 0, 0, 6, 255, 4, 0, 20, 0, 1,
    ]);
    transport.simulateData(
      tcpFrame(1, 255, Uint8Array.from([4, 2, 0xab, 0xcd])),
    );
    expect(await second).toEqual({ ok: true, value: 0xabcd });
    await advanceUntil(clock, () => transport.sentFrames.length === 3);
    transport.simulateData(readResponse(2, 0, 42));
    expect(await third).toEqual({ ok: true, value: 42 });
    await session.disconnect();
  });

  it.each(["discrete-input", "input-register"])(
    "rejects writes to %s without transmitting",
    async (table) => {
      const { session, transport } = makeTcpSession();
      await session.connect();
      expect(
        await session.writeRegister(0, 1, {
          source: "manual-write",
          route: { protocol: `modbus-basic-tables:${table}`, unitAddress: 1 },
        }),
      ).toMatchObject({ ok: false, error: { code: "BASIC_TABLES_READ_ONLY" } });
      expect(transport.sentFrames).toHaveLength(0);
      await session.disconnect();
    },
  );

  it("checks coil values, quantity limits and address overflow before sending", async () => {
    const { session, transport } = makeTcpSession();
    await session.connect();
    for (const [address, quantity] of [
      [0, 0],
      [0, 2001],
      [65535, 2],
      [-1, 1],
      [0.5, 1],
    ]) {
      expect(
        (
          await session.readRegisters(address ?? 0, quantity ?? 0, {
            source: "manual-read",
            route: coil,
          })
        ).ok,
      ).toBe(false);
    }
    expect(
      (
        await session.readRegisters(0, 126, {
          source: "manual-read",
          route: input,
        })
      ).ok,
    ).toBe(false);
    for (const values of [[2], [-1], [NaN], Array<number>(1969).fill(0)]) {
      expect(
        (
          await session.writeRegisters(0, values, {
            source: "manual-write",
            route: coil,
          })
        ).ok,
      ).toBe(false);
    }
    expect(transport.sentFrames).toHaveLength(0);
    await session.disconnect();
  });

  it("supports maximum bit reads and FC0F writes beyond holding-register limits", async () => {
    const { session, transport, clock } = makeTcpSession();
    await session.connect();
    const read = session.readRegisters(0, 2000, {
      source: "manual-read",
      route: coil,
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(
      tcpFrame(
        0,
        7,
        Uint8Array.from([1, 250, ...Array<number>(250).fill(255)]),
      ),
    );
    expect(await read).toEqual({
      ok: true,
      value: Array<number>(2000).fill(1),
    });
    const write = session.writeRegisters(0, Array<number>(1968).fill(1), {
      source: "manual-write",
      route: coil,
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    expect(transport.sentFrames[1]?.length).toBe(259);
    transport.simulateData(tcpFrame(1, 7, Uint8Array.from([15, 0, 0, 7, 176])));
    expect(await write).toEqual({
      ok: true,
      value: { kind: "write-succeeded-no-verify" },
    });
    await session.disconnect();
  });

  it("allocates a fresh retry ID and rejects stale, wrong-unit and wrong-function frames", async () => {
    const { session, transport, clock } = makeTcpSession({
      profile: tcpProfile({ requestTimeoutMs: 100, retryCount: 1 }),
    });
    await session.connect();
    const result = session.readRegister(0, {
      source: "manual-read",
      route: coil,
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    expect(transport.sentFrames[1]?.[1]).toBe(1);
    transport.simulateData(
      concat(
        tcpFrame(0, 7, Uint8Array.from([1, 1, 0])),
        tcpFrame(1, 8, Uint8Array.from([1, 1, 0])),
        tcpFrame(1, 7, Uint8Array.from([2, 1, 0])),
        tcpFrame(1, 7, Uint8Array.from([1, 1, 1])),
      ),
    );
    expect(await result).toEqual({ ok: true, value: 1 });
    await session.disconnect();
  });

  it("returns device exceptions without retrying", async () => {
    const { session, transport, clock } = makeTcpSession();
    await session.connect();
    const result = session.readRegister(0, {
      source: "manual-read",
      route: input,
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(tcpFrame(0, 255, Uint8Array.from([0x84, 2])));
    expect(await result).toMatchObject({
      ok: false,
      error: { category: "modbus-exception", retryable: false },
    });
    expect(transport.sentFrames).toHaveLength(1);
    await session.disconnect();
  });

  it("cancels queued work and drops incomplete data on disconnect", async () => {
    const { session, transport, clock } = makeTcpSession();
    await session.connect();
    const first = session.readRegister(0, {
      source: "manual-read",
      route: coil,
    });
    const cancelToken = createCancellationToken();
    const queued = session.readRegister(1, {
      source: "batch-read",
      route: input,
      cancelToken,
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    cancelToken.cancel("test");
    transport.simulateData(Uint8Array.from([0, 0, 0, 0, 0, 4, 7, 1]));
    await session.disconnect();
    expect((await first).ok).toBe(false);
    expect((await queued).ok).toBe(false);
    expect(transport.sentFrames).toHaveLength(1);
    expect(
      (await session.readRegister(2, { source: "manual-read", route: coil }))
        .ok,
    ).toBe(false);
  });
});

describe("CommunicationSession over TCP", () => {
  it("TCP 读：发送 MBAP 请求（tid=0, unitId=0）并解析响应", async () => {
    const { session, transport, clock } = makeTcpSession();
    await session.connect();
    const promise = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    // 请求帧 = tid 0 / protocol 0 / unit 0 / FC03 / addr 0x0001。
    expect(Array.from(transport.sentFrames[0] ?? [])).toEqual(
      Array.from(
        encodeTcpReadHoldingRegistersRequest({
          transactionId: 0,
          unitId: 0,
          startAddress: 0x0001,
          quantity: 1,
        }),
      ),
    );
    transport.simulateData(readResponse(0, 0, 0xabcd));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0xabcd);
  });

  it("TCP 写：发送 FC0x10 请求并解析写响应", async () => {
    const { session, transport, clock } = makeTcpSession();
    await session.connect();
    const promise = session.writeRegister(0x0002, 0x1234, {
      source: "manual-write",
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    expect(Array.from(transport.sentFrames[0] ?? [])).toEqual(
      Array.from(
        encodeTcpWriteSingleRegisterRequest({
          transactionId: 0,
          unitId: 0,
          address: 0x0002,
          rawValue: 0x1234,
        }),
      ),
    );
    transport.simulateData(writeResponse(0, 0, 0x0002));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: "write-succeeded-no-verify" });
    }
  });

  it("Transaction ID 随请求递增并回绕", async () => {
    const { session, transport, clock } = makeTcpSession();
    await session.connect();
    const first = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(readResponse(0, 0, 0x0001));
    await first;

    const second = session.readRegister(0x0002, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    // 第二个请求 tid = 1。
    expect(transport.sentFrames[1]?.[0]).toBe(0);
    expect(transport.sentFrames[1]?.[1]).toBe(1);
    transport.simulateData(readResponse(1, 0, 0x0002));
    const secondResult = await second;
    expect(secondResult.ok).toBe(true);
  });

  it("TCP 重试使用新 Transaction ID（§12.2）", async () => {
    const { session, transport, clock } = makeTcpSession({
      profile: tcpProfile({ requestTimeoutMs: 1000, retryCount: 1 }),
    });
    await session.connect();
    const promise = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    expect(transport.sentFrames[0]?.[1]).toBe(0);
    // 触发第一次请求超时。
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    expect(transport.sentFrames[1]?.[1]).toBe(1);
    // 第二次尝试（新 tid）返回成功。
    transport.simulateData(readResponse(1, 0, 0x0042));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x0042);
  });

  it("迟到响应（tid 不匹配）被丢弃，不误配当前请求", async () => {
    const { session, transport, clock } = makeTcpSession();
    await session.connect();
    const promise = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    // 先到旧 tid 的迟到响应，再到当前 tid 的响应。
    transport.simulateData(
      concat(readResponse(0xffff, 0, 0x1111), readResponse(0, 0, 0x2222)),
    );
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x2222);
  });

  it("半包响应：分片到达后解析成功", async () => {
    const { session, transport, clock } = makeTcpSession();
    await session.connect();
    const promise = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    const frame = readResponse(0, 0, 0x3333);
    transport.simulateData(frame.slice(0, 4));
    transport.simulateData(frame.slice(4));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x3333);
  });

  it("unitId 透传：请求与响应均使用会话 Unit ID，日志 protocol=tcp", async () => {
    const logs: CommunicationLogEvent[] = [];
    const { session, transport, clock } = makeTcpSession({
      unitId: 5,
      onLog: (e) => logs.push(e),
    });
    await session.connect();
    const promise = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    // 请求帧 unit 字节 = 5。
    expect(transport.sentFrames[0]?.[6]).toBe(5);
    transport.simulateData(readResponse(0, 5, 0x0055));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x0055);
    const reqLog = logs.find((l) => l.direction === "request");
    expect(reqLog?.protocol).toBe("tcp");
    expect(reqLog?.slaveAddress).toBe(5);
  });

  it("setUnitId 后请求帧 Unit ID 变化：动态更新对后续请求生效", async () => {
    const { session, transport, clock } = makeTcpSession({ unitId: 3 });
    await session.connect();

    // 动态更新 Unit ID 为 9：后续请求帧 unit 字节 = 9（对齐 RTU setSlaveAddress 语义）。
    session.setUnitId(9);
    const promise = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    expect(transport.sentFrames[0]?.[6]).toBe(9);

    // 响应也必须匹配新 Unit ID 才被接受。
    transport.simulateData(readResponse(0, 9, 0x0077));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x0077);
  });

  it("异常响应：返回 Modbus 异常错误", async () => {
    const { session, transport, clock } = makeTcpSession();
    await session.connect();
    const promise = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(tcpFrame(0, 0, Uint8Array.from([0x83, 0x02])));
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MODBUS_EXCEPTION_02");
  });

  it("TCP 会话断开关闭传输", async () => {
    const { session, transport } = makeTcpSession();
    await session.connect();
    const result = await session.disconnect();
    expect(result.ok).toBe(true);
    expect(transport.closed).toBe(true);
    expect(session.getState()).toBe("disconnected");
  });
});
