import { describe, expect, it } from "vitest";
import { appendCrc } from "./crc16";
import {
  MemobusCodec,
  MEMOBUS_MAX_READ,
  MEMOBUS_MAX_WRITE,
} from "./memobus-codec";
import type { CodecExpect } from "@mamep2026/communication";

/** "01 67 ..." → Uint8Array。 */
function hex(hexString: string): Uint8Array {
  return Uint8Array.from(hexString.split(" ").map((x) => parseInt(x, 16)));
}

function readExpect(addresses: number[]): CodecExpect {
  return {
    protocolId: "yaskawa-memobus-67h-010dh-010eh",
    kind: "read",
    request: { slaveAddress: 1, addresses },
  };
}

function writeExpect(
  entries: Array<{ address: number; value: number }>,
): CodecExpect {
  return {
    protocolId: "yaskawa-memobus-67h-010dh-010eh",
    kind: "write",
    request: { slaveAddress: 1, entries },
  };
}

const codec = new MemobusCodec();

// 手册表 6.11 / 6.12 向量（docs/安川MEMOBUS公开协议参考.md §6，用户 2026-08-31 已确认 CRC 一致）。
const READ_REQ = hex("01 67 01 0D 00 02 00 24 00 28 8B 29");
const READ_RES = hex("01 67 01 0D 00 04 17 70 03 E8 47 ED");
const EXCEPTION = hex("01 E7 02 EA 31");
const WRITE_REQ = hex("01 67 01 0E 00 02 00 04 00 02 17 70 00 04 05 DC 55 59");
const WRITE_RES = hex("01 67 01 0E 00 02 D5 FC");

describe("crc16（标准 CRC-16/MODBUS）", () => {
  it("matches the manual CRC vectors", () => {
    expect(appendCrc(hex("01 67 01 0D 00 02 00 24 00 28"))).toEqual(READ_REQ);
    expect(appendCrc(hex("01 67 01 0D 00 04 17 70 03 E8"))).toEqual(READ_RES);
    expect(appendCrc(hex("01 E7 02"))).toEqual(EXCEPTION);
    expect(
      appendCrc(hex("01 67 01 0E 00 02 00 04 00 02 17 70 00 04 05 DC")),
    ).toEqual(WRITE_REQ);
    expect(appendCrc(hex("01 67 01 0E 00 02"))).toEqual(WRITE_RES);
  });
});

describe("MemobusCodec encode", () => {
  it("encodeRead produces the manual 67/010D request", () => {
    const frame = codec.encodeRead({
      slaveAddress: 1,
      addresses: [0x0024, 0x0028],
    });
    expect(frame).toEqual(READ_REQ);
  });

  it("encodeWrite produces the manual 67/010E request (byteCount = count × 2)", () => {
    const frame = codec.encodeWrite({
      slaveAddress: 1,
      entries: [
        { address: 0x0002, value: 0x1770 },
        { address: 0x0004, value: 0x05dc },
      ],
    });
    expect(frame).toEqual(WRITE_REQ);
  });

  it("enforces read quantity limit (1..120)", () => {
    // createMamepError 返回普通对象（非 Error 实例）：捕获后断言 code。
    const tooMany = (() => {
      try {
        codec.encodeRead({
          slaveAddress: 1,
          addresses: Array.from({ length: MEMOBUS_MAX_READ + 1 }, (_, i) => i),
        });
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect((tooMany as { code?: string } | null)?.code).toBe(
      "MEMOBUS_QUANTITY_OUT_OF_RANGE",
    );
    const empty = (() => {
      try {
        codec.encodeRead({ slaveAddress: 1, addresses: [] });
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect((empty as { code?: string } | null)?.code).toBe(
      "MEMOBUS_QUANTITY_OUT_OF_RANGE",
    );
  });

  it("enforces write quantity limit (1..60)", () => {
    const tooMany = (() => {
      try {
        codec.encodeWrite({
          slaveAddress: 1,
          entries: Array.from({ length: MEMOBUS_MAX_WRITE + 1 }, (_, i) => ({
            address: i,
            value: 0,
          })),
        });
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect((tooMany as { code?: string } | null)?.code).toBe(
      "MEMOBUS_QUANTITY_OUT_OF_RANGE",
    );
    const empty = (() => {
      try {
        codec.encodeWrite({ slaveAddress: 1, entries: [] });
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect((empty as { code?: string } | null)?.code).toBe(
      "MEMOBUS_QUANTITY_OUT_OF_RANGE",
    );
  });

  it("exposes maxRead=120 / maxWrite=60", () => {
    expect(codec.maxRead).toBe(120);
    expect(codec.maxWrite).toBe(60);
  });
});

describe("MemobusCodec decodeResponse", () => {
  it("decodes the manual read response (byte order preserved)", () => {
    const result = codec.decodeResponse(READ_RES, readExpect([0x0024, 0x0028]));
    expect(result).toEqual({
      ok: true,
      value: { kind: "read", values: [0x1770, 0x03e8] },
    });
  });

  it("decodes the manual write response (count echo only)", () => {
    const result = codec.decodeResponse(
      WRITE_RES,
      writeExpect([
        { address: 0x0002, value: 0x1770 },
        { address: 0x0004, value: 0x05dc },
      ]),
    );
    expect(result).toEqual({ ok: true, value: { kind: "write" } });
  });

  it("decodes the manual exception response (function 0xE7)", () => {
    const result = codec.decodeResponse(EXCEPTION, readExpect([0x0024]));
    expect(result).toEqual({
      ok: true,
      value: { kind: "exception", exceptionCode: 0x02 },
    });
  });

  it("rejects a slave address mismatch", () => {
    const result = codec.decodeResponse(
      hex("02 67 01 0D 00 02 17 70 03 E8 00 00"),
      readExpect([0x0024, 0x0028]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MEMOBUS_SLAVE_MISMATCH");
  });

  it("rejects a function code mismatch", () => {
    const result = codec.decodeResponse(
      hex("01 03 00 04 17 70 03 E8 00 00"),
      readExpect([0x0024, 0x0028]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MEMOBUS_FUNCTION_MISMATCH");
  });

  it("rejects a sub-function mismatch", () => {
    const result = codec.decodeResponse(
      hex("01 67 01 0E 00 02 17 70 03 E8 00 00"),
      readExpect([0x0024, 0x0028]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("MEMOBUS_SUB_FUNCTION_MISMATCH");
  });

  it("rejects a read byte-count mismatch", () => {
    const result = codec.decodeResponse(
      hex("01 67 01 0D 00 02 17 70 03 E8 00 00"),
      readExpect([0x0024, 0x0028]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("MEMOBUS_BYTE_COUNT_MISMATCH");
  });

  it("rejects a write data-count mismatch", () => {
    const result = codec.decodeResponse(
      hex("01 67 01 0E 00 01 00 00"),
      writeExpect([
        { address: 0x0002, value: 0x1770 },
        { address: 0x0004, value: 0x05dc },
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MEMOBUS_COUNT_MISMATCH");
  });

  it("rejects a too-short frame", () => {
    const result = codec.decodeResponse(hex("01 67 01"), readExpect([0x0024]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MEMOBUS_FRAME_TOO_SHORT");
  });
});

describe("MemobusCodec parserFactory", () => {
  it("handles a half frame then the remainder", () => {
    const parser = codec.parserFactory(readExpect([0x0024, 0x0028]));
    const first = parser.push(hex("01 67 01 0D 00 04 17"));
    expect(first.done).toBe(false);
    const second = parser.push(hex("70 03 E8 47 ED"));
    expect(second.done).toBe(true);
    if (second.done && second.outcome.ok) {
      expect(second.outcome.value).toEqual({
        kind: "read",
        values: [0x1770, 0x03e8],
      });
    }
  });

  it("parses coalesced frames across pushes", () => {
    const parser = codec.parserFactory(readExpect([0x0024, 0x0028]));
    const first = parser.push(
      hex("01 67 01 0D 00 04 17 70 03 E8 47 ED 01 E7 02 EA 31"),
    );
    expect(first.done).toBe(true);
    if (first.done && first.outcome.ok) {
      expect(first.outcome.value.kind).toBe("read");
    }
    // 第二帧（异常）留在缓冲，下一 push（无新字节）返回。
    const second = parser.push(new Uint8Array(0));
    expect(second.done).toBe(true);
    if (second.done && second.outcome.ok) {
      expect(second.outcome.value).toEqual({
        kind: "exception",
        exceptionCode: 0x02,
      });
    }
  });

  it("resyncs past a leading noise byte", () => {
    const parser = codec.parserFactory(readExpect([0x0024, 0x0028]));
    const result = parser.push(hex("00 01 67 01 0D 00 04 17 70 03 E8 47 ED"));
    expect(result.done).toBe(true);
    if (result.done && result.outcome.ok) {
      expect(result.outcome.value).toEqual({
        kind: "read",
        values: [0x1770, 0x03e8],
      });
    }
  });

  it("drops a corrupt-CRC frame and resyncs to the next valid one", () => {
    const parser = codec.parserFactory(readExpect([0x0024, 0x0028]));
    // 首个完整帧 CRC 损坏（末字节改 00），随后是正确帧；损坏帧被丢弃、正确帧被解析。
    const corrupted = hex("01 67 01 0D 00 04 17 70 03 E8 47 00");
    const result = parser.push(
      Uint8Array.from([...corrupted, ...Array.from(READ_RES)]),
    );
    expect(result.done).toBe(true);
    if (result.done && result.outcome.ok) {
      expect(result.outcome.value).toEqual({
        kind: "read",
        values: [0x1770, 0x03e8],
      });
    }
  });
});

describe("MemobusCodec mapException", () => {
  it("maps an exception code to MEMOBUS_EXCEPTION_XX", () => {
    const error = codec.mapException(0x02);
    expect(error.code).toBe("MEMOBUS_EXCEPTION_02");
    expect(error.category).toBe("modbus-exception");
    expect(error.retryable).toBe(false);
  });
});
