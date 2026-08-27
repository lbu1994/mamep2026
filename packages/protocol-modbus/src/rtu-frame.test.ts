import { describe, expect, it } from "vitest";
import {
  decodeRtuResponse,
  encodeReadHoldingRegistersRequest,
  encodeWriteMultipleRegistersRequest,
  encodeWriteSingleRegisterRequest,
  expectedResponseLength,
  MAX_READ_QUANTITY,
  MAX_WRITE_QUANTITY,
  type ExpectedResponse,
} from "./rtu-frame";

function expectOk<T>(
  result: import("@mamep2026/domain").Result<T>,
): asserts result is { ok: true; value: T } {
  expect(result.ok).toBe(true);
}

describe("encodeReadHoldingRegistersRequest", () => {
  it("encodes FC03 single register read with the known vector", () => {
    const bytes = encodeReadHoldingRegistersRequest({
      slaveAddress: 1,
      startAddress: 0,
      quantity: 1,
    });
    expect(Array.from(bytes)).toEqual([
      0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0x84, 0x0a,
    ]);
  });

  it("encodes address 0x0A with big-endian address and quantity", () => {
    const bytes = encodeReadHoldingRegistersRequest({
      slaveAddress: 0x11,
      startAddress: 0x000a,
      quantity: 1,
    });
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    expect(hex).toBe("11 03 00 0a 00 01 " + crcSuffix(bytes));
  });

  function crcSuffix(bytes: Uint8Array): string {
    return [bytes[6]!, bytes[7]!]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
  }
});

describe("encodeWriteSingleRegisterRequest", () => {
  it("encodes FC0x10 with one register, value as big-endian payload", () => {
    const bytes = encodeWriteSingleRegisterRequest({
      slaveAddress: 1,
      address: 0x0001,
      rawValue: 0x1234,
    });
    expect(Array.from(bytes.slice(0, 7))).toEqual([
      0x01, 0x10, 0x00, 0x01, 0x00, 0x01, 0x02,
    ]);
    expect(bytes[7]).toBe(0x12);
    expect(bytes[8]).toBe(0x34);
  });

  it("uses function code 0x10 even for a single register", () => {
    const bytes = encodeWriteSingleRegisterRequest({
      slaveAddress: 1,
      address: 0,
      rawValue: 1,
    });
    expect(bytes[1]).toBe(0x10);
  });
});

describe("decodeRtuResponse", () => {
  function withCrc(payload: number[]): Uint8Array {
    const body = Uint8Array.from(payload);
    const frame = new Uint8Array(body.length + 2);
    frame.set(body, 0);
    const crc = crcOf(body);
    frame[body.length] = crc & 0xff;
    frame[body.length + 1] = (crc >> 8) & 0xff;
    return frame;
  }

  function crcOf(bytes: Uint8Array): number {
    // 使用与实现相同的标准 CRC-16/Modbus（在 crc16.test.ts 中用标准向量验证）
    let crc = 0xffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) {
        crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
      }
    }
    return crc;
  }

  const readExpect: ExpectedResponse = {
    kind: "read-holding",
    slaveAddress: 1,
    startAddress: 0x0001,
    quantity: 1,
  };

  it("decodes a valid FC03 response", () => {
    const frame = withCrc([0x01, 0x03, 0x02, 0x12, 0x34]);
    const result = decodeRtuResponse(frame, readExpect);
    expectOk(result);
    const decoded = result.value;
    if (decoded.kind === "read-holding") {
      expect(decoded.values).toEqual([0x1234]);
    } else {
      expect.fail("expected read-holding response");
    }
  });

  it("decodes a valid FC0x10 response", () => {
    const writeExpect: ExpectedResponse = {
      kind: "write-single",
      slaveAddress: 1,
      address: 0x0001,
      quantity: 1,
    };
    const frame = withCrc([0x01, 0x10, 0x00, 0x01, 0x00, 0x01]);
    const result = decodeRtuResponse(frame, writeExpect);
    expectOk(result);
    expect(result.value.kind).toBe("write-single");
  });

  it("decodes a Modbus exception response", () => {
    const frame = withCrc([0x01, 0x83, 0x02]);
    const result = decodeRtuResponse(frame, readExpect);
    expectOk(result);
    const decoded = result.value;
    if (decoded.kind === "exception") {
      expect(decoded.exceptionCode).toBe(2);
    } else {
      expect.fail("expected exception response");
    }
  });

  it("rejects frames with a bad CRC", () => {
    const frame = withCrc([0x01, 0x03, 0x02, 0x12, 0x34]);
    frame[frame.length - 1] = (frame[frame.length - 1] ?? 0) ^ 0xff;
    const result = decodeRtuResponse(frame, readExpect);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RTU_CRC_MISMATCH");
  });

  it("rejects mismatched slave address", () => {
    const frame = withCrc([0x02, 0x03, 0x02, 0x12, 0x34]);
    const result = decodeRtuResponse(frame, readExpect);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RTU_SLAVE_MISMATCH");
  });

  it("rejects mismatched function code", () => {
    const frame = withCrc([0x01, 0x04, 0x02, 0x12, 0x34]);
    const result = decodeRtuResponse(frame, readExpect);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RTU_FUNCTION_MISMATCH");
  });

  it("rejects wrong byte count for FC03", () => {
    const frame = withCrc([0x01, 0x03, 0x04, 0x12, 0x34]);
    const result = decodeRtuResponse(frame, readExpect);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RTU_BYTE_COUNT_MISMATCH");
  });

  it("rejects wrong data length (too few bytes)", () => {
    const frame = withCrc([0x01, 0x03, 0x01, 0x12]);
    const result = decodeRtuResponse(frame, readExpect);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RTU_INVALID_LENGTH");
  });

  it("rejects mismatched write start address", () => {
    const writeExpect: ExpectedResponse = {
      kind: "write-single",
      slaveAddress: 1,
      address: 0x0001,
      quantity: 1,
    };
    const frame = withCrc([0x01, 0x10, 0x00, 0x02, 0x00, 0x01]);
    const result = decodeRtuResponse(frame, writeExpect);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RTU_ADDRESS_MISMATCH");
  });

  it("rejects mismatched write quantity", () => {
    const writeExpect: ExpectedResponse = {
      kind: "write-single",
      slaveAddress: 1,
      address: 0x0001,
      quantity: 1,
    };
    const frame = withCrc([0x01, 0x10, 0x00, 0x01, 0x00, 0x02]);
    const result = decodeRtuResponse(frame, writeExpect);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RTU_QUANTITY_MISMATCH");
  });

  it("rejects too-short frames", () => {
    const result = decodeRtuResponse(Uint8Array.from([0x01, 0x03]), readExpect);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RTU_INVALID_LENGTH");
  });
});

describe("expectedResponseLength", () => {
  it("reports 7 bytes for a normal FC03 single register response and 5 for exception", () => {
    expect(expectedResponseLength("read-holding", 1)).toEqual({
      normal: 7,
      exception: 5,
    });
  });

  it("reports 8 bytes for a normal FC0x10 single register response and 5 for exception", () => {
    expect(expectedResponseLength("write-single")).toEqual({
      normal: 8,
      exception: 5,
    });
  });
});

describe("encodeWriteMultipleRegistersRequest (ADR-030)", () => {
  it("encodes FC0x10 multi-register write with quantity and byte count", () => {
    const bytes = encodeWriteMultipleRegistersRequest({
      slaveAddress: 1,
      startAddress: 0x0001,
      values: [0x1234, 0xabcd],
    });
    expect(Array.from(bytes.slice(0, 9))).toEqual([
      0x01, 0x10, 0x00, 0x01, 0x00, 0x02, 0x04, 0x12, 0x34,
    ]);
    expect(bytes[9]).toBe(0xab);
    expect(bytes[10]).toBe(0xcd);
  });

  it("encodes a 3-register write (binary 48-bit use case)", () => {
    const bytes = encodeWriteMultipleRegistersRequest({
      slaveAddress: 0x11,
      startAddress: 0x0000,
      values: [0x0001, 0x0002, 0x0003],
    });
    expect(Array.from(bytes.slice(0, 9))).toEqual([
      0x11, 0x10, 0x00, 0x00, 0x00, 0x03, 0x06, 0x00, 0x01,
    ]);
    expect(bytes[12]).toBe(0x03);
  });
});

describe("decodeRtuResponse write-multiple (ADR-030)", () => {
  function withCrc(payload: number[]): Uint8Array {
    const body = Uint8Array.from(payload);
    const frame = new Uint8Array(body.length + 2);
    frame.set(body, 0);
    let crc = 0xffff;
    for (const byte of body) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) {
        crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
      }
    }
    frame[body.length] = crc & 0xff;
    frame[body.length + 1] = (crc >> 8) & 0xff;
    return frame;
  }

  it("decodes a write-multiple echo with quantity 2", () => {
    const expectMulti: ExpectedResponse = {
      kind: "write-multiple",
      slaveAddress: 1,
      address: 0x0001,
      quantity: 2,
    };
    const frame = withCrc([0x01, 0x10, 0x00, 0x01, 0x00, 0x02]);
    const result = decodeRtuResponse(frame, expectMulti);
    expectOk(result);
    expect(result.value.kind).toBe("write-multiple");
  });

  it("rejects write-multiple quantity mismatch", () => {
    const expectMulti: ExpectedResponse = {
      kind: "write-multiple",
      slaveAddress: 1,
      address: 0x0001,
      quantity: 2,
    };
    const frame = withCrc([0x01, 0x10, 0x00, 0x01, 0x00, 0x03]);
    const result = decodeRtuResponse(frame, expectMulti);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RTU_QUANTITY_MISMATCH");
  });
});

describe("quantity limits (ADR-030)", () => {
  it("exposes RTU read/write quantity ceilings", () => {
    expect(MAX_READ_QUANTITY).toBe(125);
    expect(MAX_WRITE_QUANTITY).toBe(123);
  });
});
