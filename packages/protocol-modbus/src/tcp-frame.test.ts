import { describe, expect, it } from "vitest";
import {
  decodeTcpResponse,
  encodeTcpReadHoldingRegistersRequest,
  encodeTcpWriteMultipleRegistersRequest,
  encodeTcpWriteSingleRegisterRequest,
  type TcpExpectedResponse,
} from "./tcp-frame";

const READ_EXPECT: TcpExpectedResponse = {
  kind: "read-holding",
  transactionId: 0x1234,
  unitId: 1,
  startAddress: 0x0000,
  quantity: 1,
};

const WRITE_EXPECT: TcpExpectedResponse = {
  kind: "write-single",
  transactionId: 0x1234,
  unitId: 1,
  address: 0x0001,
  quantity: 1,
};

describe("encodeTcpReadHoldingRegistersRequest", () => {
  it("builds MBAP header + PDU with correct length", () => {
    const frame = encodeTcpReadHoldingRegistersRequest({
      transactionId: 0x1234,
      unitId: 1,
      startAddress: 0x0000,
      quantity: 1,
    });
    // 6(MBAP 前 6 字节) + length(6) = 12。
    expect(Array.from(frame)).toEqual([
      0x12,
      0x34, // transaction id
      0x00,
      0x00, // protocol id
      0x00,
      0x06, // length = unitId(1) + pdu(5)
      0x01, // unit id
      0x03, // function read
      0x00,
      0x00, // start address
      0x00,
      0x01, // quantity
    ]);
  });
});

describe("encodeTcpWriteSingleRegisterRequest", () => {
  it("builds MBAP header + PDU for FC0x10", () => {
    const frame = encodeTcpWriteSingleRegisterRequest({
      transactionId: 0x0001,
      unitId: 2,
      address: 0x0001,
      rawValue: 0x1234,
    });
    expect(Array.from(frame)).toEqual([
      0x00,
      0x01, // transaction id
      0x00,
      0x00, // protocol id
      0x00,
      0x09, // length = unitId(1) + pdu(8)
      0x02, // unit id
      0x10, // function write multiple
      0x00,
      0x01, // address
      0x00,
      0x01, // quantity = 1
      0x02, // byte count
      0x12,
      0x34, // value
    ]);
  });
});

describe("encodeTcpWriteMultipleRegistersRequest (ADR-030)", () => {
  it("builds MBAP header + PDU for FC0x10 multi-register write", () => {
    const frame = encodeTcpWriteMultipleRegistersRequest({
      transactionId: 0x0001,
      unitId: 2,
      startAddress: 0x0001,
      values: [0x1234, 0xabcd],
    });
    expect(Array.from(frame)).toEqual([
      0x00,
      0x01, // transaction id
      0x00,
      0x00, // protocol id
      0x00,
      0x0b, // length = unitId(1) + pdu(10)
      0x02, // unit id
      0x10, // function write multiple
      0x00,
      0x01, // start address
      0x00,
      0x02, // quantity = 2
      0x04, // byte count
      0x12,
      0x34, // value 1
      0xab,
      0xcd, // value 2
    ]);
  });
});

describe("decodeTcpResponse write-multiple (ADR-030)", () => {
  it("decodes a write-multiple echo with quantity 2", () => {
    const expectMulti: TcpExpectedResponse = {
      kind: "write-multiple",
      transactionId: 0x1234,
      unitId: 1,
      address: 0x0001,
      quantity: 2,
    };
    const response = Uint8Array.from([
      0x12, 0x34, 0x00, 0x00, 0x00, 0x06, 0x01, 0x10, 0x00, 0x01, 0x00, 0x02,
    ]);
    const result = decodeTcpResponse(response, expectMulti);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: "write-multiple" });
    }
  });
});

describe("decodeTcpResponse", () => {
  it("decodes a read-holding response", () => {
    const response = Uint8Array.from([
      0x12, 0x34, 0x00, 0x00, 0x00, 0x05, 0x01, 0x03, 0x02, 0x12, 0x34,
    ]);
    const result = decodeTcpResponse(response, READ_EXPECT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: "read-holding", values: [0x1234] });
    }
  });

  it("decodes a write response", () => {
    const response = Uint8Array.from([
      0x12, 0x34, 0x00, 0x00, 0x00, 0x06, 0x01, 0x10, 0x00, 0x01, 0x00, 0x01,
    ]);
    const result = decodeTcpResponse(response, WRITE_EXPECT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: "write-single" });
    }
  });

  it("decodes an exception response", () => {
    const response = Uint8Array.from([
      0x12, 0x34, 0x00, 0x00, 0x00, 0x03, 0x01, 0x83, 0x02,
    ]);
    const result = decodeTcpResponse(response, READ_EXPECT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: "exception", exceptionCode: 0x02 });
    }
  });

  it("rejects non-zero protocol identifier", () => {
    const response = Uint8Array.from([
      0x12, 0x34, 0x00, 0x01, 0x00, 0x05, 0x01, 0x03, 0x02, 0x12, 0x34,
    ]);
    const result = decodeTcpResponse(response, READ_EXPECT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TCP_PROTOCOL_MISMATCH");
  });

  it("rejects transaction id mismatch", () => {
    const response = Uint8Array.from([
      0x00, 0x01, 0x00, 0x00, 0x00, 0x05, 0x01, 0x03, 0x02, 0x12, 0x34,
    ]);
    const result = decodeTcpResponse(response, READ_EXPECT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TCP_TRANSACTION_MISMATCH");
  });

  it("rejects unit id mismatch", () => {
    const response = Uint8Array.from([
      0x12, 0x34, 0x00, 0x00, 0x00, 0x05, 0x02, 0x03, 0x02, 0x12, 0x34,
    ]);
    const result = decodeTcpResponse(response, READ_EXPECT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TCP_UNIT_ID_MISMATCH");
  });

  it("rejects frames whose length does not match MBAP length field", () => {
    const response = Uint8Array.from([
      0x12, 0x34, 0x00, 0x00, 0x00, 0x04, 0x01, 0x03, 0x02, 0x12, 0x34,
    ]);
    const result = decodeTcpResponse(response, READ_EXPECT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TCP_INVALID_LENGTH");
  });

  it("rejects too-short frames", () => {
    const response = Uint8Array.from([0x12, 0x34, 0x00, 0x00, 0x00]);
    const result = decodeTcpResponse(response, READ_EXPECT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TCP_INVALID_LENGTH");
  });

  it("rejects wrong function code", () => {
    const response = Uint8Array.from([
      0x12, 0x34, 0x00, 0x00, 0x00, 0x05, 0x01, 0x04, 0x02, 0x12, 0x34,
    ]);
    const result = decodeTcpResponse(response, READ_EXPECT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TCP_FUNCTION_MISMATCH");
  });

  it("rejects byte count mismatch", () => {
    const response = Uint8Array.from([
      0x12, 0x34, 0x00, 0x00, 0x00, 0x05, 0x01, 0x03, 0x04, 0x12, 0x34,
    ]);
    const result = decodeTcpResponse(response, READ_EXPECT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TCP_BYTE_COUNT_MISMATCH");
  });

  it("rejects truncated read data", () => {
    const response = Uint8Array.from([
      0x12, 0x34, 0x00, 0x00, 0x00, 0x04, 0x01, 0x03, 0x02, 0x12,
    ]);
    const result = decodeTcpResponse(response, READ_EXPECT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TCP_INVALID_LENGTH");
  });

  it("rejects write address mismatch", () => {
    const response = Uint8Array.from([
      0x12, 0x34, 0x00, 0x00, 0x00, 0x06, 0x01, 0x10, 0x00, 0x02, 0x00, 0x01,
    ]);
    const result = decodeTcpResponse(response, WRITE_EXPECT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TCP_ADDRESS_MISMATCH");
  });

  it("rejects write quantity mismatch", () => {
    const response = Uint8Array.from([
      0x12, 0x34, 0x00, 0x00, 0x00, 0x06, 0x01, 0x10, 0x00, 0x01, 0x00, 0x02,
    ]);
    const result = decodeTcpResponse(response, WRITE_EXPECT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TCP_QUANTITY_MISMATCH");
  });

  it("round-trips unit id 0 and 255 (MBAP full range)", () => {
    for (const unitId of [0, 255]) {
      const request = {
        transactionId: 0x0102,
        unitId,
        startAddress: 0,
        quantity: 1,
      };
      const requestFrame = encodeTcpReadHoldingRegistersRequest(request);
      expect(requestFrame[6]).toBe(unitId);
      const response = Uint8Array.from([
        0x01,
        0x02,
        0x00,
        0x00,
        0x00,
        0x05,
        unitId,
        0x03,
        0x02,
        0x12,
        0x34,
      ]);
      const result = decodeTcpResponse(response, {
        ...READ_EXPECT,
        transactionId: 0x0102,
        unitId,
      });
      expect(result.ok).toBe(true);
    }
  });

  it("round-trips transaction id 0xFFFF", () => {
    const response = Uint8Array.from([
      0xff, 0xff, 0x00, 0x00, 0x00, 0x05, 0x01, 0x03, 0x02, 0x12, 0x34,
    ]);
    const result = decodeTcpResponse(response, {
      ...READ_EXPECT,
      transactionId: 0xffff,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: "read-holding", values: [0x1234] });
    }
  });
});
