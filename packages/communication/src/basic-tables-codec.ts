/**
 * 基础表 RTU 编解码器。
 *
 * 核心内置：coil / discrete-input / input-register 三个基础表类型各一个 codec 实例，
 * protocolId = "modbus-basic-tables:<tableType>"（见 domain `basicTablesProtocolId`）。
 * - coil：FC01 读 / FC0F 写（位打包，值 0/1）；
 * - discrete-input：FC02 读（只读）；
 * - input-register：FC04 读（只读）。
 *
 * 设计注记：`CodecReadRequest`/`CodecWriteRequest` 不携带表类型（仅 slaveAddress+addresses/entries），
 * 故每个基础表类型注册独立 codec 实例（protocolId 带表类型后缀），CommunicationSession codec 路径零改动。
 * 帧编解码复用 protocol-modbus 帧层纯函数（encodeReadBitsRequest/encodeReadInputRegistersRequest/
 * encodeWriteMultipleCoilsRequest/decodeRtuResponse/expectedResponseLength）。
 */
import {
  basicTablesProtocolId,
  createMamepError,
  fail,
  ok,
  type BasicSheetType,
  type MamepError,
  type Result,
} from "@mamep2026/domain";
import {
  decodeRtuResponse,
  encodeReadBitsRequest,
  encodeReadInputRegistersRequest,
  encodeWriteMultipleCoilsRequest,
  expectedResponseLength,
  FUNCTION_READ_COILS,
  FUNCTION_READ_DISCRETE_INPUTS,
  FUNCTION_READ_INPUT_REGISTERS,
  FUNCTION_WRITE_MULTIPLE_COILS,
  MAX_READ_BITS_QUANTITY,
  MAX_READ_QUANTITY,
  MAX_WRITE_COILS_QUANTITY,
} from "@mamep2026/protocol-modbus";
import type {
  CodecDecodedResponse,
  CodecExpect,
  CodecReadRequest,
  CodecRegistry,
  CodecWriteRequest,
  FrameParser,
  ProtocolCodec,
} from "./codec";

function basicTablesError(
  code: string,
  category: "validation" | "capability" | "protocol",
  technicalMessage: string,
): MamepError {
  return createMamepError({
    code,
    category,
    severity: "error",
    retryable: false,
    userMessageKey: "errors.internal",
    technicalMessage,
  });
}

/** 表类型 → 读期望 kind（仅读类）。 */
type BasicReadKind =
  "read-coils" | "read-discrete-inputs" | "read-input-registers";

function readKindFor(tableType: BasicSheetType): BasicReadKind {
  switch (tableType) {
    case "coil":
      return "read-coils";
    case "discrete-input":
      return "read-discrete-inputs";
    case "input-register":
      return "read-input-registers";
  }
}

/** 表类型 → 读功能码。 */
function readFunctionFor(tableType: BasicSheetType): number {
  switch (tableType) {
    case "coil":
      return FUNCTION_READ_COILS;
    case "discrete-input":
      return FUNCTION_READ_DISCRETE_INPUTS;
    case "input-register":
      return FUNCTION_READ_INPUT_REGISTERS;
  }
}

export class BasicTablesRtuCodec implements ProtocolCodec {
  readonly protocolId: string;
  readonly tableType: BasicSheetType;
  readonly maxRead: number;
  readonly maxWrite: number;

  constructor(tableType: BasicSheetType) {
    this.tableType = tableType;
    this.protocolId = basicTablesProtocolId(tableType);
    this.maxRead =
      tableType === "input-register"
        ? MAX_READ_QUANTITY
        : MAX_READ_BITS_QUANTITY;
    this.maxWrite = tableType === "coil" ? MAX_WRITE_COILS_QUANTITY : 0;
  }

  /**
   * 读请求：地址列表按连续范围编码（基础表读恒为连续区段）。
   * coil/discrete-input → FC01/FC02 位打包；input-register → FC04 16 位。
   */
  encodeRead(req: CodecReadRequest): Uint8Array {
    const quantity = req.addresses.length;
    if (quantity < 1 || quantity > this.maxRead) {
      throw basicTablesError(
        "BASIC_TABLES_QUANTITY_OUT_OF_RANGE",
        "validation",
        `basic table read quantity out of range: ${quantity}`,
      );
    }
    const startAddress = req.addresses[0] ?? 0;
    if (this.tableType === "coil") {
      return encodeReadBitsRequest(
        { slaveAddress: req.slaveAddress, startAddress, quantity },
        FUNCTION_READ_COILS,
      );
    }
    if (this.tableType === "discrete-input") {
      return encodeReadBitsRequest(
        { slaveAddress: req.slaveAddress, startAddress, quantity },
        FUNCTION_READ_DISCRETE_INPUTS,
      );
    }
    return encodeReadInputRegistersRequest({
      slaveAddress: req.slaveAddress,
      startAddress,
      quantity,
    });
  }

  /** 写请求：仅 coil（FC0F 位打包写）。discrete-input/input-register 只读。 */
  encodeWrite(req: CodecWriteRequest): Uint8Array {
    if (this.tableType !== "coil") {
      throw basicTablesError(
        "BASIC_TABLES_READ_ONLY",
        "capability",
        `table type is read-only: ${this.tableType}`,
      );
    }
    const quantity = req.entries.length;
    if (quantity < 1 || quantity > this.maxWrite) {
      throw basicTablesError(
        "BASIC_TABLES_QUANTITY_OUT_OF_RANGE",
        "validation",
        `basic table write quantity out of range: ${quantity}`,
      );
    }
    const values = req.entries.map((entry) => entry.value);
    const startAddress = req.entries[0]?.address ?? 0;
    return encodeWriteMultipleCoilsRequest({
      slaveAddress: req.slaveAddress,
      startAddress,
      values,
    });
  }

  /** 解码响应：委托 protocol-modbus `decodeRtuResponse`（含 CRC 校验），再映射到 codec 判别名。 */
  decodeResponse(
    frame: Uint8Array,
    expect: CodecExpect,
  ): Result<CodecDecodedResponse> {
    const slaveAddress = expect.request.slaveAddress;
    if (expect.kind === "read") {
      const quantity = expect.request.addresses.length;
      const startAddress = expect.request.addresses[0] ?? 0;
      let result: Result<
        import("@mamep2026/protocol-modbus").DecodedRtuResponse
      >;
      switch (this.tableType) {
        case "coil":
          result = decodeRtuResponse(frame, {
            kind: "read-coils",
            slaveAddress,
            startAddress,
            quantity,
          });
          break;
        case "discrete-input":
          result = decodeRtuResponse(frame, {
            kind: "read-discrete-inputs",
            slaveAddress,
            startAddress,
            quantity,
          });
          break;
        case "input-register":
          result = decodeRtuResponse(frame, {
            kind: "read-input-registers",
            slaveAddress,
            startAddress,
            quantity,
          });
          break;
      }
      if (!result.ok) return result;
      if (result.value.kind === "exception") {
        return ok({
          kind: "exception",
          exceptionCode: result.value.exceptionCode,
        });
      }
      if (
        result.value.kind === "read-coils" ||
        result.value.kind === "read-discrete-inputs" ||
        result.value.kind === "read-input-registers"
      ) {
        return ok({ kind: "read", values: result.value.values });
      }
      return fail(
        basicTablesError(
          "BASIC_TABLES_UNEXPECTED_RESPONSE",
          "protocol",
          `unexpected decoded kind: ${result.value.kind}`,
        ),
      );
    }
    const quantity = expect.request.entries.length;
    const address = expect.request.entries[0]?.address ?? 0;
    const result = decodeRtuResponse(frame, {
      kind: "write-multiple-coils",
      slaveAddress,
      address,
      quantity,
    });
    if (!result.ok) return result;
    if (result.value.kind === "exception") {
      return ok({
        kind: "exception",
        exceptionCode: result.value.exceptionCode,
      });
    }
    if (result.value.kind === "write-multiple-coils") {
      return ok({ kind: "write" });
    }
    return fail(
      basicTablesError(
        "BASIC_TABLES_UNEXPECTED_RESPONSE",
        "protocol",
        `unexpected decoded kind: ${result.value.kind}`,
      ),
    );
  }

  /** RTU 式期望长度分帧 + 从站地址重同步 + CRC 校验（decodeResponse 内含 CRC）。 */
  parserFactory(expect: CodecExpect): FrameParser {
    const expectedSlave = expect.request.slaveAddress & 0xff;
    const lengths = this.expectedLength(expect.kind, expect);
    const expectedFunction =
      expect.kind === "read"
        ? readFunctionFor(this.tableType)
        : FUNCTION_WRITE_MULTIPLE_COILS;
    let buffer: number[] = [];

    const tryParse = ():
      | { done: false }
      | {
          done: true;
          outcome: Result<CodecDecodedResponse>;
          frame: Uint8Array;
        } => {
      while (true) {
        // 以从站地址字节重同步（半包/粘包/噪声）。
        const slaveIdx = buffer.indexOf(expectedSlave);
        if (slaveIdx === -1) {
          buffer = [];
          return { done: false };
        }
        if (slaveIdx > 0) {
          buffer = buffer.slice(slaveIdx);
        }
        if (buffer.length < 2) return { done: false };
        const functionByte = buffer[1] ?? -1;
        let frameLength: number;
        if (functionByte === expectedFunction) {
          frameLength = lengths.normal;
        } else if (functionByte === (expectedFunction | 0x80)) {
          frameLength = lengths.exception;
        } else {
          // 噪声字节：丢弃后重新同步。
          buffer.shift();
          continue;
        }
        if (buffer.length < frameLength) return { done: false };
        const frame = Uint8Array.from(buffer.slice(0, frameLength));
        const outcome = this.decodeResponse(frame, expect);
        if (outcome.ok) {
          buffer = buffer.slice(frameLength);
          return { done: true, outcome, frame };
        }
        // CRC 或语义校验失败：丢弃首字节继续尝试同步，最终由超时兜底。
        buffer.shift();
      }
    };

    return {
      push(chunk: Uint8Array) {
        for (const byte of chunk) buffer.push(byte);
        return tryParse();
      },
    };
  }

  expectedLength(
    kind: "read" | "write",
    expect: CodecExpect,
  ): { normal: number; exception: number } {
    if (kind === "read") {
      const quantity =
        expect.kind === "read" ? expect.request.addresses.length : 1;
      return expectedResponseLength(readKindFor(this.tableType), quantity);
    }
    return expectedResponseLength("write-multiple-coils", 1);
  }
}

/** 向注册表注册全部基础表 codec（coil/discrete-input/input-register），三端装配共用。 */
export function registerBasicTablesCodecs(registry: CodecRegistry): void {
  for (const tableType of [
    "coil",
    "discrete-input",
    "input-register",
  ] as const) {
    registry.register(new BasicTablesRtuCodec(tableType));
  }
}
