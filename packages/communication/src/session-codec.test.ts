import { describe, expect, it } from "vitest";
import { appendCrc } from "@mamep2026/protocol-modbus";
import {
  createDefaultRtuProfile,
  createMamepError,
  fail,
  ok,
  type MamepError,
  type Result,
} from "@mamep2026/domain";
import {
  createCodecRegistry,
  type CodecDecodedResponse,
  type CodecExpect,
  type CodecReadRequest,
  type CodecWriteRequest,
  type FrameParser,
  type ProtocolCodec,
} from "./codec";
import { CommunicationSession } from "./session";
import type { CommunicationLogEvent } from "./log-event";
import { FakeTransport } from "./testing/fake-transport";
import { ManualClock, advanceUntil } from "./testing/manual-clock";

/**
 * 极简 MEMOBUS 形状的 fake codec（FC 0x67 + 子功能 010D/010E，ADR-040）：
 * 用于验证会话 codec 注入路径（编解码细节由 protocol-memobus 包专项覆盖）。
 */
class FakeMemobusCodec implements ProtocolCodec {
  readonly protocolId = "yaskawa-memobus";
  readonly maxRead = 120;
  readonly maxWrite = 60;

  encodeRead(req: CodecReadRequest): Uint8Array {
    const count = req.addresses.length;
    const body = Uint8Array.from([
      req.slaveAddress & 0xff,
      0x67,
      0x01,
      0x0d,
      (count >> 8) & 0xff,
      count & 0xff,
      ...req.addresses.flatMap((a) => [(a >> 8) & 0xff, a & 0xff]),
    ]);
    return appendCrc(body);
  }

  encodeWrite(req: CodecWriteRequest): Uint8Array {
    const count = req.entries.length;
    const body = Uint8Array.from([
      req.slaveAddress & 0xff,
      0x67,
      0x01,
      0x0e,
      (count >> 8) & 0xff,
      count & 0xff,
      0x00,
      (count * 2) & 0xff,
      ...req.entries.flatMap((e) => [
        (e.address >> 8) & 0xff,
        e.address & 0xff,
        (e.value >> 8) & 0xff,
        e.value & 0xff,
      ]),
    ]);
    return appendCrc(body);
  }

  decodeResponse(
    frame: Uint8Array,
    expect: CodecExpect,
  ): Result<CodecDecodedResponse> {
    const slave = frame[0] ?? 0;
    const fn = frame[1] ?? 0;
    if (fn === (0x67 | 0x80)) {
      return ok({ kind: "exception", exceptionCode: frame[2] ?? 0 });
    }
    if (slave !== expect.request.slaveAddress || fn !== 0x67) {
      return fail(
        createMamepError({
          code: "FAKE_MISMATCH",
          category: "protocol",
          severity: "error",
          retryable: false,
          userMessageKey: "errors.internal",
          technicalMessage: "fake mismatch",
        }),
      );
    }
    if (expect.kind === "read") {
      const count = expect.request.addresses.length;
      const values: number[] = [];
      for (let i = 0; i < count; i++) {
        const hi = frame[6 + i * 2] ?? 0;
        const lo = frame[7 + i * 2] ?? 0;
        values.push((hi << 8) | lo);
      }
      return ok({ kind: "read", values });
    }
    return ok({ kind: "write" });
  }

  parserFactory(expect: CodecExpect): FrameParser {
    const normal =
      expect.kind === "read" ? 8 + expect.request.addresses.length * 2 : 8;
    let buffer: number[] = [];
    // 箭头函数闭包捕获 this（codec），避免 this 别名（no-this-alias）。
    const tryParse = ():
      | { done: false }
      | {
          done: true;
          outcome: Result<CodecDecodedResponse>;
          frame: Uint8Array;
        } => {
      while (true) {
        if (buffer.length < 5) return { done: false };
        const fn = buffer[1] ?? -1;
        const len = fn === 0x67 ? normal : fn === 0xe7 ? 5 : -1;
        if (len === -1 || buffer.length < len) return { done: false };
        const frame = Uint8Array.from(buffer.slice(0, len));
        buffer = buffer.slice(len);
        return {
          done: true,
          outcome: this.decodeResponse(frame, expect),
          frame,
        };
      }
    };
    return {
      push(chunk: Uint8Array) {
        for (const byte of chunk) buffer.push(byte);
        return tryParse();
      },
    };
  }

  expectedLength(_kind: "read" | "write", expect: CodecExpect) {
    // 帧长以 expect.kind 为准（接口保留 kind 形参以对齐 ProtocolCodec 签名）。
    return expect.kind === "read"
      ? { normal: 8 + expect.request.addresses.length * 2, exception: 5 }
      : { normal: 8, exception: 5 };
  }

  mapException(exceptionCode: number): MamepError {
    return createMamepError({
      code: `MEMOBUS_EXCEPTION_${exceptionCode.toString(16).toUpperCase().padStart(2, "0")}`,
      category: "modbus-exception",
      severity: "warning",
      retryable: false,
      userMessageKey: "errors.modbusException",
      technicalMessage: `memobus exception code ${exceptionCode}`,
    });
  }
}

function makeCodecSession(opts?: {
  onLog?: (e: CommunicationLogEvent) => void;
}) {
  const clock = new ManualClock();
  const transport = new FakeTransport();
  const registry = createCodecRegistry();
  registry.register(new FakeMemobusCodec());
  const session = new CommunicationSession({
    transport,
    clock,
    config: createDefaultRtuProfile(),
    protocol: "yaskawa-memobus",
    codecRegistry: registry,
    ...(opts?.onLog !== undefined ? { onLog: opts.onLog } : {}),
  });
  return { clock, transport, session };
}

function makeRtuSession() {
  const clock = new ManualClock();
  const transport = new FakeTransport();
  const session = new CommunicationSession({
    transport,
    clock,
    config: createDefaultRtuProfile(),
  });
  return { clock, transport, session };
}

/** 模拟 codec 读响应：slave + 67 + 010D + byteCount + values + crc。 */
function readResponse(slave: number, values: number[]): Uint8Array {
  return appendCrc(
    Uint8Array.from([
      slave,
      0x67,
      0x01,
      0x0d,
      0x00,
      values.length * 2,
      ...values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]),
    ]),
  );
}

/** 模拟 codec 写响应：slave + 67 + 010E + count + crc。 */
function writeResponse(slave: number, count: number): Uint8Array {
  return appendCrc(Uint8Array.from([slave, 0x67, 0x01, 0x0e, 0x00, count]));
}

function exceptionResponse(slave: number, code: number): Uint8Array {
  return appendCrc(Uint8Array.from([slave, 0x67 | 0x80, code]));
}

describe("CommunicationSession codec path (ADR-040)", () => {
  it("readRegistersAt sends a codec frame and decodes the response values", async () => {
    const { session, transport, clock } = makeCodecSession();
    await session.connect();

    const promise = session.readRegistersAt([0x0024, 0x0028], {
      source: "manual-read",
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    // 帧头：slave + 67 + 010D + 个数(2) + 地址列表。
    expect(Array.from(transport.sentFrames[0] ?? []).slice(0, 10)).toEqual([
      0x01, 0x67, 0x01, 0x0d, 0x00, 0x02, 0x00, 0x24, 0x00, 0x28,
    ]);

    transport.simulateData(readResponse(1, [0x1770, 0x03e8]));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([0x1770, 0x03e8]);
  });

  it("writeRegistersAt sends a codec write frame and returns write-succeeded-no-verify", async () => {
    const { session, transport, clock } = makeCodecSession();
    await session.connect();

    const promise = session.writeRegistersAt(
      [
        { address: 0x0002, value: 0x1770 },
        { address: 0x0004, value: 0x05dc },
      ],
      { source: "manual-write" },
    );
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    const frame = transport.sentFrames[0] ?? new Uint8Array();
    // 帧头：slave + 67 + 010E + 个数 + 字节数（=个数×2）。
    expect(Array.from(frame.slice(0, 8))).toEqual([
      0x01, 0x67, 0x01, 0x0e, 0x00, 0x02, 0x00, 0x04,
    ]);
    // 数据区：地址/值成对。
    expect(Array.from(frame.slice(8, 16))).toEqual([
      0x00, 0x02, 0x17, 0x70, 0x00, 0x04, 0x05, 0xdc,
    ]);

    transport.simulateData(writeResponse(1, 2));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("write-succeeded-no-verify");
  });

  it("rejects readRegistersAt on a built-in rtu session with CODEC_REQUIRED", async () => {
    const { session } = makeRtuSession();
    await session.connect();
    const result = await session.readRegistersAt([0x0001], {
      source: "manual-read",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CODEC_REQUIRED");
  });

  it("throws CODEC_NOT_FOUND for an unknown codecId at construction", () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    // createMamepError 返回普通对象（非 Error 实例）：捕获后断言 code。
    let thrown: unknown = null;
    try {
      new CommunicationSession({
        transport,
        clock,
        config: createDefaultRtuProfile(),
        protocol: "no-such-codec",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).not.toBeNull();
    expect((thrown as { code?: string }).code).toBe("CODEC_NOT_FOUND");
  });

  it("maps a codec exception via codec.mapException", async () => {
    const { session, transport, clock } = makeCodecSession();
    await session.connect();

    const promise = session.readRegistersAt([0x0900], {
      source: "manual-read",
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(exceptionResponse(1, 0x02));
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MEMOBUS_EXCEPTION_02");
      expect(result.error.category).toBe("modbus-exception");
    }
  });

  it("enforces the codec read quantity upper bound (maxRead)", async () => {
    const { session } = makeCodecSession();
    await session.connect();
    const addresses = Array.from({ length: 121 }, (_, i) => i);
    const result = await session.readRegistersAt(addresses, {
      source: "manual-read",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("QUANTITY_OUT_OF_RANGE");
  });

  it("routes contiguous readRegisters through the codec when protocol is a codecId", async () => {
    const { session, transport, clock } = makeCodecSession();
    await session.connect();

    const promise = session.readRegisters(0x0100, 2, {
      source: "manual-read",
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    // 连续 2 个：地址 0x0100、0x0101。
    expect(Array.from(transport.sentFrames[0] ?? []).slice(6, 10)).toEqual([
      0x01, 0x00, 0x01, 0x01,
    ]);
    transport.simulateData(readResponse(1, [0x0001, 0x0002]));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([0x0001, 0x0002]);
  });

  it("records the codecId in emitted log protocol fields", async () => {
    const logs: CommunicationLogEvent[] = [];
    const { session, transport, clock } = makeCodecSession({
      onLog: (e) => logs.push(e),
    });
    await session.connect();

    const promise = session.readRegistersAt([0x0024], {
      source: "manual-read",
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(readResponse(1, [0x1234]));
    await promise;

    const requestLog = logs.find((e) => e.direction === "request");
    expect(requestLog?.protocol).toBe("yaskawa-memobus");
    const responseLog = logs.find((e) => e.direction === "response");
    expect(responseLog?.protocol).toBe("yaskawa-memobus");
  });

  it("times out on the codec path when no response arrives (retries then fails)", async () => {
    const { session, transport, clock } = makeCodecSession();
    await session.connect();

    const promise = session.readRegistersAt([0x0024], {
      source: "manual-read",
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    // 默认 profile：requestTimeoutMs=50、retryCount=1 → 2 次尝试各超时。
    // advanceUntil 步进 + flush microtask，让重试链路能注册下一次超时定时器。
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await advanceUntil(clock, () => settled, 100, 80);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("REQUEST_TIMEOUT");
  });
});
