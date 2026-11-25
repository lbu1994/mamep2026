/** Shared Modbus PDU semantics. ADU wrappers validate transport headers. */
import {
  createMamepError,
  fail,
  ok,
  type MamepError,
  type Result,
} from "@mamep2026/domain";

export const FUNCTION_READ_COILS = 0x01;
export const FUNCTION_READ_DISCRETE_INPUTS = 0x02;
export const FUNCTION_READ_HOLDING = 0x03;
export const FUNCTION_READ_INPUT_REGISTERS = 0x04;
export const FUNCTION_WRITE_MULTIPLE_COILS = 0x0f;
export const FUNCTION_WRITE_MULTIPLE = 0x10;

export const EXCEPTION_ILLEGAL_FUNCTION = 0x01;
export const EXCEPTION_ILLEGAL_DATA_ADDRESS = 0x02;
export const EXCEPTION_ILLEGAL_DATA_VALUE = 0x03;

/** Maximum register count for FC03 and FC04. */
export const MAX_READ_QUANTITY = 125;
/** Maximum register count for FC10. */
export const MAX_WRITE_QUANTITY = 123;
/** Maximum bit count for FC01 and FC02. */
export const MAX_READ_BITS_QUANTITY = 2000;
/** Maximum coil count for FC0F. */
export const MAX_WRITE_COILS_QUANTITY = 1968;

export type PduExpectedResponse =
  | {
      kind: "read-holding";
      startAddress: number;
      quantity: number;
    }
  | {
      kind: "read-coils";
      startAddress: number;
      quantity: number;
    }
  | {
      kind: "read-discrete-inputs";
      startAddress: number;
      quantity: number;
    }
  | {
      kind: "read-input-registers";
      startAddress: number;
      quantity: number;
    }
  | {
      kind: "write-single";
      address: number;
      quantity: number;
    }
  | {
      kind: "write-multiple";
      address: number;
      quantity: number;
    }
  | {
      kind: "write-multiple-coils";
      address: number;
      quantity: number;
    };

export type DecodedPduResponse =
  | { kind: "read-holding"; values: number[] }
  | { kind: "read-coils"; values: number[] }
  | { kind: "read-discrete-inputs"; values: number[] }
  | { kind: "read-input-registers"; values: number[] }
  | { kind: "write-single" }
  | { kind: "write-multiple" }
  | { kind: "write-multiple-coils" }
  | { kind: "exception"; exceptionCode: number };

/** Return whether the read response packs one value per bit. */
export function isBitPackedRead(kind: PduExpectedResponse["kind"]): boolean {
  return kind === "read-coils" || kind === "read-discrete-inputs";
}

/** Map the expected response kind to its function code. */
export function functionCodeForKind(kind: PduExpectedResponse["kind"]): number {
  switch (kind) {
    case "read-coils":
      return FUNCTION_READ_COILS;
    case "read-discrete-inputs":
      return FUNCTION_READ_DISCRETE_INPUTS;
    case "read-holding":
      return FUNCTION_READ_HOLDING;
    case "read-input-registers":
      return FUNCTION_READ_INPUT_REGISTERS;
    case "write-multiple-coils":
      return FUNCTION_WRITE_MULTIPLE_COILS;
    case "write-single":
    case "write-multiple":
      return FUNCTION_WRITE_MULTIPLE;
  }
}

/** Encode a contiguous read PDU for FC01, FC02, FC03 or FC04. */
export function encodeReadPdu(
  functionCode: number,
  startAddress: number,
  quantity: number,
): Uint8Array {
  return Uint8Array.from([
    functionCode,
    startAddress >> 8,
    startAddress & 0xff,
    quantity >> 8,
    quantity & 0xff,
  ]);
}

/** Encode FC0F bits or FC10 words in address order. Coil values must be 0 or 1. */
export function encodeWritePdu(
  functionCode: number,
  startAddress: number,
  values: number[],
): Uint8Array {
  const bits = functionCode === FUNCTION_WRITE_MULTIPLE_COILS;
  const quantity = values.length;
  const byteCount = bits ? Math.ceil(quantity / 8) : quantity * 2;
  const pdu = new Uint8Array(6 + byteCount);
  pdu.set([
    functionCode,
    startAddress >> 8,
    startAddress & 0xff,
    quantity >> 8,
    quantity & 0xff,
    byteCount,
  ]);
  for (let valueIndex = 0; valueIndex < quantity; valueIndex++) {
    const value = values[valueIndex] ?? 0;
    if (bits) {
      if (value !== 0) {
        const byteIndex = 6 + (valueIndex >> 3);
        pdu[byteIndex] = (pdu[byteIndex] ?? 0) | (1 << (valueIndex & 7));
      }
    } else {
      pdu[6 + valueIndex * 2] = value >> 8;
      pdu[7 + valueIndex * 2] = value & 0xff;
    }
  }
  return pdu;
}

/** Decode the PDU after header validation; preserve the ADU error-code namespace. */
export function decodeResponsePdu(
  frame: Uint8Array,
  expected: PduExpectedResponse,
  errorPrefix: "RTU" | "TCP",
): Result<DecodedPduResponse> {
  const functionCode = frame[0] ?? -1;

  const expectedFunction = functionCodeForKind(expected.kind);
  if (
    (functionCode & 0x7f) === expectedFunction &&
    (functionCode & 0x80) !== 0
  ) {
    if (frame.length !== 2) {
      return fail(
        protocolError(
          `${errorPrefix}_INVALID_LENGTH`,
          `exception frame PDU must be 2 bytes, got ${frame.length}`,
        ),
      );
    }
    return ok({ kind: "exception", exceptionCode: frame[1] ?? 0 });
  }

  if (functionCode !== expectedFunction) {
    return fail(
      protocolError(
        `${errorPrefix}_FUNCTION_MISMATCH`,
        `function mismatch: expected ${expectedFunction.toString(16)}, got ${functionCode.toString(16)}`,
      ),
    );
  }

  if (
    expected.kind === "read-holding" ||
    expected.kind === "read-input-registers" ||
    expected.kind === "read-coils" ||
    expected.kind === "read-discrete-inputs"
  ) {
    const dataBytes = isBitPackedRead(expected.kind)
      ? Math.ceil(expected.quantity / 8)
      : expected.quantity * 2;
    if (frame.length !== 2 + dataBytes) {
      return fail(
        protocolError(
          `${errorPrefix}_INVALID_LENGTH`,
          `read frame must be ${2 + dataBytes} bytes, got ${frame.length}`,
        ),
      );
    }
    const byteCount = frame[1] ?? -1;
    if (byteCount !== dataBytes) {
      return fail(
        protocolError(
          `${errorPrefix}_BYTE_COUNT_MISMATCH`,
          `byte count expected ${dataBytes}, got ${byteCount}`,
        ),
      );
    }
    // Unpack exactly the requested number of bits or words.
    const values: number[] = [];
    for (let valueIndex = 0; valueIndex < expected.quantity; valueIndex++) {
      if (isBitPackedRead(expected.kind)) {
        const byte = frame[2 + (valueIndex >> 3)];
        values.push(byte === undefined ? 0 : (byte >> (valueIndex & 7)) & 1);
      } else {
        const hi = frame[2 + valueIndex * 2];
        const lo = frame[3 + valueIndex * 2];
        if (hi === undefined || lo === undefined) {
          return fail(
            protocolError(
              `${errorPrefix}_DATA_LENGTH_MISMATCH`,
              "read response data truncated",
            ),
          );
        }
        values.push((hi << 8) | lo);
      }
    }
    return ok({ kind: expected.kind, values });
  }

  if (frame.length !== 5) {
    return fail(
      protocolError(
        `${errorPrefix}_INVALID_LENGTH`,
        `write frame PDU must be 5 bytes, got ${frame.length}`,
      ),
    );
  }
  const respAddress = ((frame[1] ?? 0) << 8) | (frame[2] ?? 0);
  if (respAddress !== expected.address) {
    return fail(
      protocolError(
        `${errorPrefix}_ADDRESS_MISMATCH`,
        `address expected ${expected.address}, got ${respAddress}`,
      ),
    );
  }
  const respQuantity = ((frame[3] ?? 0) << 8) | (frame[4] ?? 0);
  if (respQuantity !== expected.quantity) {
    return fail(
      protocolError(
        `${errorPrefix}_QUANTITY_MISMATCH`,
        `quantity expected ${expected.quantity}, got ${respQuantity}`,
      ),
    );
  }
  return ok({ kind: expected.kind });
}

function protocolError(code: string, technicalMessage: string): MamepError {
  return createMamepError({
    code,
    category: "protocol",
    severity: "error",
    retryable: false,
    userMessageKey: `errors.${code.toLowerCase().replaceAll("_", "")}`,
    technicalMessage,
  });
}
