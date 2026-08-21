import { describe, expect, it } from "vitest";
import type { RtuConnectionProfile } from "@mamep2026/domain";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import { appendCrc } from "@mamep2026/protocol-modbus";
import { CommunicationSession } from "./session";
import type { CommunicationLogEvent } from "./log-event";
import { FakeTransport } from "./testing/fake-transport";
import { ManualClock, advanceUntil } from "./testing/manual-clock";

function makeSession(opts?: {
  profile?: RtuConnectionProfile;
  onLog?: (e: CommunicationLogEvent) => void;
}) {
  const clock = new ManualClock();
  const transport = new FakeTransport();
  const profile = opts?.profile ?? createDefaultRtuProfile();
  const session = new CommunicationSession({
    transport,
    clock,
    config: profile,
    ...(opts?.onLog !== undefined ? { onLog: opts.onLog } : {}),
  });
  return { clock, transport, session, profile };
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

describe("CommunicationSession connect/disconnect", () => {
  it("connects when transport opens", async () => {
    const { session, transport } = makeSession();
    const result = await session.connect();
    expect(result.ok).toBe(true);
    expect(transport.opened).toBe(true);
    expect(session.getState()).toBe("connected");
  });

  it("rejects requests while disconnected", async () => {
    const { session } = makeSession();
    const result = await session.readRegister(0x0001, {
      source: "manual-read",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONNECTION_NOT_CONNECTED");
  });

  it("disconnects and closes the transport", async () => {
    const { session, transport } = makeSession();
    await session.connect();
    const result = await session.disconnect();
    expect(result.ok).toBe(true);
    expect(transport.closed).toBe(true);
    expect(session.getState()).toBe("disconnected");
  });

  it("disconnect is idempotent", async () => {
    const { session } = makeSession();
    await session.connect();
    await session.disconnect();
    const second = await session.disconnect();
    expect(second.ok).toBe(true);
    expect(session.getState()).toBe("disconnected");
  });
});

describe("CommunicationSession readRegister", () => {
  it("sends a FC03 frame and returns the decoded raw value", async () => {
    const { session, transport, clock } = makeSession();
    await session.connect();

    const promise = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    expect(Array.from(transport.sentFrames[0] ?? [])).toEqual([
      0x01, 0x03, 0x00, 0x01, 0x00, 0x01, 0xd5, 0xca,
    ]);

    transport.simulateData(readResponse(1, 0x1234));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x1234);
  });

  it("uses the dynamically updated slave address for subsequent requests", async () => {
    const { session, transport, clock } = makeSession();
    await session.connect();

    // 默认从站地址 1；动态更新为 5 后，后续请求帧首字节为 0x05。
    session.setSlaveAddress(5);
    const promise = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    expect(Array.from(transport.sentFrames[0] ?? [])[0]).toBe(0x05);

    transport.simulateData(readResponse(5, 0x1234));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x1234);
  });

  it("logs request and response bytes", async () => {
    const logs: CommunicationLogEvent[] = [];
    const { session, transport, clock } = makeSession({
      onLog: (e) => logs.push(e),
    });
    await session.connect();

    const promise = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(readResponse(1, 0x1234));
    await promise;

    expect(logs).toHaveLength(2);
    expect(logs[0]?.direction).toBe("request");
    expect(logs[0]?.status).toBe("success");
    expect(logs[1]?.direction).toBe("response");
    expect(logs[1]?.status).toBe("success");
  });

  it("retries on timeout and succeeds on the second attempt", async () => {
    const logs: CommunicationLogEvent[] = [];
    const { session, transport, clock } = makeSession({
      onLog: (e) => logs.push(e),
    });
    await session.connect();

    const promise = session.readRegister(0x0001, { source: "manual-read" });
    // 第一次请求发出后不响应 -> 超时
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    clock.advance(1500);
    await Promise.resolve();
    // 重试发出第二次请求
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    transport.simulateData(readResponse(1, 0x0022));
    const result = await promise;

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x22);
    const requestLogs = logs.filter((l) => l.direction === "request");
    expect(requestLogs).toHaveLength(2);
    expect(requestLogs[0]?.attempt).toBe(1);
    expect(requestLogs[1]?.attempt).toBe(2);
    expect(logs.some((l) => l.status === "timeout")).toBe(true);
  });

  it("fails with timeout after retries are exhausted", async () => {
    const { session, transport, clock } = makeSession();
    await session.connect();

    const promise = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    clock.advance(2500);
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("REQUEST_TIMEOUT");
      expect(result.error.category).toBe("timeout");
    }
  });

  it("does not retry Modbus exception responses", async () => {
    const { session, transport, clock } = makeSession();
    await session.connect();

    const promise = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(exceptionResponse(1, 0x03, 0x02));
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MODBUS_EXCEPTION_02");
      expect(result.error.category).toBe("modbus-exception");
    }
    expect(transport.sentFrames).toHaveLength(1);
  });

  it("retries on CRC errors and succeeds when a valid frame arrives", async () => {
    const { session, transport, clock } = makeSession();
    await session.connect();

    const promise = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    const bad = readResponse(1, 0x1234);
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 0xff;
    transport.simulateData(bad);
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    transport.simulateData(readResponse(1, 0x0007));
    const result = await promise;

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(7);
  });

  it("discards late responses arriving after timeout", async () => {
    const logs: CommunicationLogEvent[] = [];
    const { session, transport, clock } = makeSession({
      onLog: (e) => logs.push(e),
    });
    await session.connect();

    // 第一次请求超时并重试一次后仍超时，整体失败。
    const first = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    clock.advance(1500);
    const firstResult = await first;
    expect(firstResult.ok).toBe(false);

    // 超时后旧帧迟到 -> 丢弃，不得影响后续请求。
    transport.simulateData(readResponse(1, 0x9999));
    await advanceUntil(clock, () => logs.some((l) => l.status === "discarded"));

    const second = session.readRegister(0x0002, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 3);
    transport.simulateData(readResponse(1, 0x0042));
    const result = await second;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x42);
  });
});

describe("CommunicationSession writeRegister", () => {
  it("sends a FC0x10 frame with one register", async () => {
    const { session, transport, clock } = makeSession();
    await session.connect();

    const promise = session.writeRegister(0x0001, 0x1234, {
      source: "manual-write",
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    const expectedBody = Uint8Array.from([
      0x01, 0x10, 0x00, 0x01, 0x00, 0x01, 0x02, 0x12, 0x34,
    ]);
    expect(Array.from(transport.sentFrames[0] ?? [])).toEqual(
      Array.from(appendCrc(expectedBody)),
    );

    transport.simulateData(writeResponse(1, 0x0001));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("write-succeeded-no-verify");
  });

  it("returns a Modbus exception failure and does not retry on exception response", async () => {
    const { session, transport, clock } = makeSession();
    await session.connect();

    const promise = session.writeRegister(0x0001, 0x1234, {
      source: "manual-write",
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    // 写入异常响应：功能码 0x10|0x80 = 0x90，异常码 0x02（Illegal Data Address）。
    transport.simulateData(exceptionResponse(1, 0x10, 0x02));
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MODBUS_EXCEPTION_02");
      expect(result.error.category).toBe("modbus-exception");
      expect(result.error.userMessageKey).toBe("errors.modbusException");
      expect(result.error.retryable).toBe(false);
    }
    // 异常响应不重试（§13.2）。
    expect(transport.sentFrames).toHaveLength(1);
  });
});

describe("CommunicationSession transport close/error", () => {
  it("transitions to interrupted when the transport closes unexpectedly", async () => {
    const { session, transport } = makeSession();
    await session.connect();
    expect(session.getState()).toBe("connected");

    transport.simulateClose();

    expect(session.getState()).toBe("interrupted");
  });

  it("rejects new requests after an unexpected close", async () => {
    const { session, transport } = makeSession();
    await session.connect();
    transport.simulateClose();

    const result = await session.readRegister(0x0001, {
      source: "manual-read",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONNECTION_NOT_CONNECTED");
  });

  it("cancels an in-flight exchange when the transport closes", async () => {
    const { session, transport, clock } = makeSession();
    await session.connect();
    const promise = session.readRegister(0x0001, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);

    transport.simulateClose();

    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CANCELLED");
  });

  it("transitions to interrupted and logs a failure on transport error", async () => {
    const logs: CommunicationLogEvent[] = [];
    const { session, transport } = makeSession({ onLog: (e) => logs.push(e) });
    await session.connect();

    transport.simulateError({
      code: "SERIAL_DEVICE_DISCONNECTED",
      category: "connection",
      severity: "error",
      retryable: false,
      userMessageKey: "errors.serialDeviceDisconnected",
      technicalMessage: "device unplugged",
    });

    expect(session.getState()).toBe("interrupted");
    expect(
      logs.some(
        (l) =>
          l.status === "failure" &&
          l.errorCode === "SERIAL_DEVICE_DISCONNECTED",
      ),
    ).toBe(true);
  });

  it("does not interrupt during a normal disconnect", async () => {
    const { session } = makeSession();
    await session.connect();
    // FakeTransport.close() 内部会触发 close 监听器。
    await session.disconnect();
    expect(session.getState()).toBe("disconnected");
  });
});
