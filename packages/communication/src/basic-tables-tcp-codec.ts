import {
  BASIC_SHEET_TYPE_IDS,
  basicTablesProtocolId,
  createMamepError,
  fail,
  ok,
  type BasicSheetType,
  type Result,
} from "@mamep2026/domain";
import {
  encodeTcpReadBitsRequest,
  encodeTcpReadInputRegistersRequest,
  encodeTcpWriteMultipleCoilsRequest,
  FUNCTION_READ_COILS,
  FUNCTION_READ_DISCRETE_INPUTS,
  FUNCTION_READ_INPUT_REGISTERS,
  FUNCTION_WRITE_MULTIPLE_COILS,
  MAX_READ_BITS_QUANTITY,
  MAX_READ_QUANTITY,
  MAX_WRITE_COILS_QUANTITY,
  type TcpExpectedResponse,
} from "@mamep2026/protocol-modbus";

/** Core table semantics over TCP. The session owns scheduling and transaction IDs. */
export class BasicTablesTcpCodec {
  readonly tableType: BasicSheetType;
  readonly protocolId: string;
  readonly maxRead: number;
  readonly maxWrite: number;
  readonly readFunction: number;
  readonly writeFunction = FUNCTION_WRITE_MULTIPLE_COILS;

  constructor(tableType: BasicSheetType) {
    this.tableType = tableType;
    this.protocolId = basicTablesProtocolId(tableType);
    this.maxRead =
      tableType === "input-register"
        ? MAX_READ_QUANTITY
        : MAX_READ_BITS_QUANTITY;
    this.maxWrite = tableType === "coil" ? MAX_WRITE_COILS_QUANTITY : 0;
    this.readFunction =
      tableType === "coil"
        ? FUNCTION_READ_COILS
        : tableType === "discrete-input"
          ? FUNCTION_READ_DISCRETE_INPUTS
          : FUNCTION_READ_INPUT_REGISTERS;
  }

  /** Reject invalid ranges before queuing or packing the address into 16 bits. */
  validateRead(address: number, quantity: number): Result<void> {
    return this.validateRange(address, quantity, this.maxRead);
  }

  /** Reject read-only tables and non-bit coil values without sending a request. */
  validateWrite(address: number, values: number[]): Result<void> {
    if (this.tableType !== "coil") {
      return fail(
        createMamepError({
          code: "BASIC_TABLES_READ_ONLY",
          category: "capability",
          userMessageKey: "errors.internal",
          technicalMessage: `table type is read-only: ${this.tableType}`,
        }),
      );
    }
    const range = this.validateRange(address, values.length, this.maxWrite);
    if (!range.ok) return range;
    if (values.some((value) => value !== 0 && value !== 1)) {
      return fail(
        createMamepError({
          code: "BASIC_TABLES_INVALID_COIL_VALUE",
          category: "validation",
          userMessageKey: "errors.internal",
          technicalMessage: "coil values must be 0 or 1",
        }),
      );
    }
    return ok(undefined);
  }

  private validateRange(
    address: number,
    quantity: number,
    maximum: number,
  ): Result<void> {
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > maximum ||
      !Number.isInteger(address) ||
      address < 0 ||
      address + quantity > 0x10000
    ) {
      return fail(
        createMamepError({
          code: "BASIC_TABLES_INVALID_RANGE",
          category: "validation",
          userMessageKey: "errors.internal",
          technicalMessage: `invalid basic table range: address=${address}, quantity=${quantity}, maximum=${maximum}`,
        }),
      );
    }
    return ok(undefined);
  }

  /** Encode one validated read attempt and its immutable response expectation. */
  buildReadAttempt(
    transactionId: number,
    unitId: number,
    startAddress: number,
    quantity: number,
  ): {
    frame: Uint8Array;
    expect: TcpExpectedResponse;
  } {
    const valid = this.validateRead(startAddress, quantity);
    if (!valid.ok) throw valid.error;
    const request = { transactionId, unitId, startAddress, quantity };
    return {
      frame:
        this.tableType === "input-register"
          ? encodeTcpReadInputRegistersRequest(request)
          : encodeTcpReadBitsRequest(request, this.readFunction),
      expect: {
        ...request,
        kind:
          this.tableType === "coil"
            ? "read-coils"
            : this.tableType === "discrete-input"
              ? "read-discrete-inputs"
              : "read-input-registers",
      },
    };
  }

  /** Encode one validated FC0F attempt; the acknowledgement must echo address and quantity. */
  buildWriteAttempt(
    transactionId: number,
    unitId: number,
    startAddress: number,
    values: number[],
  ): {
    frame: Uint8Array;
    expect: TcpExpectedResponse;
  } {
    const valid = this.validateWrite(startAddress, values);
    if (!valid.ok) throw valid.error;
    return {
      frame: encodeTcpWriteMultipleCoilsRequest({
        transactionId,
        unitId,
        startAddress,
        values,
      }),
      expect: {
        kind: "write-multiple-coils",
        transactionId,
        unitId,
        address: startAddress,
        quantity: values.length,
      },
    };
  }
}

const codecs = new Map(
  BASIC_SHEET_TYPE_IDS.map((tableType) => {
    const codec = new BasicTablesTcpCodec(tableType);
    return [codec.protocolId, codec] as const;
  }),
);

/** Resolve only core TCP codecs; an RTU plugin is never reused on a TCP connection. */
export function getBasicTablesTcpCodec(
  protocol: string,
): BasicTablesTcpCodec | undefined {
  return codecs.get(protocol);
}
