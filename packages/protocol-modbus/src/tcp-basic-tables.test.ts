import { describe, expect, it } from "vitest";
import {
  decodeTcpResponse,
  encodeTcpReadBitsRequest,
  encodeTcpReadInputRegistersRequest,
  encodeTcpWriteMultipleCoilsRequest,
  type TcpExpectedResponse,
} from "./tcp-frame";

function frame(
  pdu: number[],
  transactionId = 0x1234,
  unitId = 255,
): Uint8Array {
  const length = pdu.length + 1;
  return Uint8Array.from([
    transactionId >> 8,
    transactionId & 255,
    0,
    0,
    length >> 8,
    length & 255,
    unitId,
    ...pdu,
  ]);
}

const cases = [
  {
    kind: "read-coils",
    fc: 1,
    quantity: 9,
    pdu: [1, 2, 0x85, 0xff],
    values: [1, 0, 1, 0, 0, 0, 0, 1, 1],
  },
  {
    kind: "read-discrete-inputs",
    fc: 2,
    quantity: 9,
    pdu: [2, 2, 0x85, 0xff],
    values: [1, 0, 1, 0, 0, 0, 0, 1, 1],
  },
  {
    kind: "read-input-registers",
    fc: 4,
    quantity: 2,
    pdu: [4, 4, 0xab, 0xcd, 0x12, 0x34],
    values: [0xabcd, 0x1234],
  },
] as const;

describe.each(cases)("TCP $kind", ({ kind, fc, quantity, pdu, values }) => {
  const request = {
    transactionId: 0x1234,
    unitId: 255,
    startAddress: 0x0102,
    quantity,
  };
  const expected: TcpExpectedResponse = { ...request, kind };

  it("encodes MBAP and the read PDU without CRC", () => {
    const encoded =
      fc === 4
        ? encodeTcpReadInputRegistersRequest(request)
        : encodeTcpReadBitsRequest(request, fc);
    expect([...encoded]).toEqual([
      0x12,
      0x34,
      0,
      0,
      0,
      6,
      255,
      fc,
      1,
      2,
      0,
      quantity,
    ]);
  });

  it("decodes requested values and ignores padding bits", () => {
    expect(decodeTcpResponse(frame([...pdu]), expected)).toEqual({
      ok: true,
      value: { kind, values },
    });
  });

  it.each([
    [0, 0x23, "TCP_TRANSACTION_MISMATCH"],
    [2, 1, "TCP_PROTOCOL_MISMATCH"],
    [5, 99, "TCP_INVALID_LENGTH"],
    [6, 1, "TCP_UNIT_ID_MISMATCH"],
    [7, 3, "TCP_FUNCTION_MISMATCH"],
    [8, 99, "TCP_BYTE_COUNT_MISMATCH"],
  ] as const)(
    "rejects a mismatched field at offset %i",
    (offset, value, code) => {
      const response = frame([...pdu]);
      response[offset] = value;
      expect(decodeTcpResponse(response, expected)).toMatchObject({
        ok: false,
        error: { code },
      });
    },
  );

  it("rejects extra or missing data even when MBAP length agrees", () => {
    for (const bad of [[...pdu, 0], pdu.slice(0, -1)]) {
      expect(decodeTcpResponse(frame(bad), expected)).toMatchObject({
        ok: false,
        error: { code: "TCP_INVALID_LENGTH" },
      });
    }
  });

  it("accepts only the matching two-byte exception PDU", () => {
    expect(decodeTcpResponse(frame([fc | 0x80, 2]), expected)).toEqual({
      ok: true,
      value: { kind: "exception", exceptionCode: 2 },
    });
    expect(decodeTcpResponse(frame([0x83, 2]), expected)).toMatchObject({
      ok: false,
      error: { code: "TCP_FUNCTION_MISMATCH" },
    });
    expect(decodeTcpResponse(frame([fc | 0x80, 2, 0]), expected)).toMatchObject(
      { ok: false, error: { code: "TCP_INVALID_LENGTH" } },
    );
  });
});

describe("TCP FC0F", () => {
  const expected: TcpExpectedResponse = {
    kind: "write-multiple-coils",
    transactionId: 0x1234,
    unitId: 255,
    address: 0x0102,
    quantity: 9,
  };

  it("packs coils LSB first and clears unused bits", () => {
    expect([
      ...encodeTcpWriteMultipleCoilsRequest({
        transactionId: 0x1234,
        unitId: 255,
        startAddress: 0x0102,
        values: [1, 0, 1, 0, 0, 0, 0, 1, 1],
      }),
    ]).toEqual([0x12, 0x34, 0, 0, 0, 9, 255, 15, 1, 2, 0, 9, 2, 0x85, 1]);
  });

  it("validates address, quantity, function, exception and exact length", () => {
    expect(decodeTcpResponse(frame([15, 1, 2, 0, 9]), expected)).toEqual({
      ok: true,
      value: { kind: "write-multiple-coils" },
    });
    for (const [pdu, code] of [
      [[15, 1, 3, 0, 9], "TCP_ADDRESS_MISMATCH"],
      [[15, 1, 2, 0, 8], "TCP_QUANTITY_MISMATCH"],
      [[16, 1, 2, 0, 9], "TCP_FUNCTION_MISMATCH"],
      [[15, 1, 2, 0, 9, 0], "TCP_INVALID_LENGTH"],
      [[0x8f, 2, 0], "TCP_INVALID_LENGTH"],
    ] as const) {
      expect(decodeTcpResponse(frame([...pdu]), expected)).toMatchObject({
        ok: false,
        error: { code },
      });
    }
    expect(decodeTcpResponse(frame([0x8f, 2]), expected)).toEqual({
      ok: true,
      value: { kind: "exception", exceptionCode: 2 },
    });
  });
});
