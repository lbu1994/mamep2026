/**
 * 自定义功能码编解码器（ADR-043 E-4 示例插件）。
 *
 * 演示「协议扩展插件」的最小完整实现：
 * - 功能码 0x65 读连续寄存器 / 0x66 写连续寄存器（RTU 承载，帧结构与 FC03/FC10 同构）；
 * - 复用 protocol-modbus 的 CRC-16（标准 CRC-16/MODBUS）；
 * - 解码/分帧模式对齐 BasicTablesRtuCodec / 安川 codec（从站地址重同步 + CRC 校验）。
 *
 * 纯示例：不进入核心 protocol-modbus（厂商/自定义功能码归插件，docs/AGENTS.md §32）。
 */
import type {
  CodecDecodedResponse,
  CodecExpect,
  CodecReadRequest,
  CodecWriteRequest,
  FrameParser,
  ProtocolCodec,
} from "@mamep2026/communication";
import type { MamepError, Result } from "@mamep2026/domain";
import { createMamepError, fail, ok } from "@mamep2026/domain";
import { appendCrc, crc16Modbus } from "@mamep2026/protocol-modbus";

/** 自定义读功能码（示例）。 */
export const CUSTOM_READ_FUNCTION = 0x65;
/** 自定义写功能码（示例）。 */
export const CUSTOM_WRITE_FUNCTION = 0x66;
/** 示例读数量上限。 */
export const CUSTOM_MAX_READ = 64;
/** 示例写数量上限。 */
export const CUSTOM_MAX_WRITE = 64;

function customError(code: string, technicalMessage: string): MamepError {
  return createMamepError({
    code,
    category: "protocol",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.internal",
    technicalMessage,
  });
}

export class CustomFunctionCodec implements ProtocolCodec {
  readonly protocolId = "custom-function-code";
  readonly maxRead = CUSTOM_MAX_READ;
  readonly maxWrite = CUSTOM_MAX_WRITE;

  /** 0x65：slave + 65 + addr(2) + quantity(2) + CRC。 */
  encodeRead(req: CodecReadRequest): Uint8Array {
    const quantity = req.addresses.length;
    if (quantity < 1 || quantity > this.maxRead) {
      throw customError(
        "CUSTOM_QUANTITY_OUT_OF_RANGE",
        `custom read quantity out of range: ${quantity}`,
      );
    }
    const startAddress = req.addresses[0] ?? 0;
    const body = Uint8Array.from([
      req.slaveAddress & 0xff,
      CUSTOM_READ_FUNCTION,
      (startAddress >> 8) & 0xff,
      startAddress & 0xff,
      (quantity >> 8) & 0xff,
      quantity & 0xff,
    ]);
    return appendCrc(body);
  }

  /** 0x66：slave + 66 + addr(2) + quantity(2) + byteCount + data + CRC。 */
  encodeWrite(req: CodecWriteRequest): Uint8Array {
    const quantity = req.entries.length;
    if (quantity < 1 || quantity > this.maxWrite) {
      throw customError(
        "CUSTOM_QUANTITY_OUT_OF_RANGE",
        `custom write quantity out of range: ${quantity}`,
      );
    }
    const startAddress = req.entries[0]?.address ?? 0;
    const body = new Uint8Array(7 + quantity * 2);
    body[0] = req.slaveAddress & 0xff;
    body[1] = CUSTOM_WRITE_FUNCTION;
    body[2] = (startAddress >> 8) & 0xff;
    body[3] = startAddress & 0xff;
    body[4] = (quantity >> 8) & 0xff;
    body[5] = quantity & 0xff;
    body[6] = quantity * 2;
    for (let i = 0; i < quantity; i += 1) {
      const value = req.entries[i]?.value ?? 0;
      body[7 + i * 2] = (value >> 8) & 0xff;
      body[8 + i * 2] = value & 0xff;
    }
    return appendCrc(body);
  }

  decodeResponse(
    frame: Uint8Array,
    expect: CodecExpect,
  ): Result<CodecDecodedResponse> {
    const slaveAddress = expect.request.slaveAddress;
    const expectedFunction =
      expect.kind === "read" ? CUSTOM_READ_FUNCTION : CUSTOM_WRITE_FUNCTION;
    if (frame.length < 5) {
      return fail(
        customError("CUSTOM_FRAME_TOO_SHORT", `frame too short: ${frame.length}`),
      );
    }
    const slave = frame[0] ?? 0;
    const functionCode = frame[1] ?? 0;
    if (slave !== slaveAddress) {
      return fail(
        customError(
          "CUSTOM_SLAVE_MISMATCH",
          `slave address mismatch: ${slave} != ${slaveAddress}`,
        ),
      );
    }
    if (functionCode === (expectedFunction | 0x80)) {
      return ok({ kind: "exception", exceptionCode: frame[2] ?? 0 });
    }
    if (functionCode !== expectedFunction) {
      return fail(
        customError(
          "CUSTOM_FUNCTION_MISMATCH",
          `function mismatch: expected ${expectedFunction.toString(16)}, got ${functionCode.toString(16)}`,
        ),
      );
    }
    if (expect.kind === "read") {
      const quantity = expect.request.addresses.length;
      const byteCount = frame[2] ?? -1;
      if (byteCount !== quantity * 2 || frame.length !== 3 + byteCount + 2) {
        return fail(
          customError(
            "CUSTOM_BYTE_COUNT_MISMATCH",
            `byte count mismatch: ${byteCount} != ${quantity * 2}`,
          ),
        );
      }
      const values: number[] = [];
      for (let i = 0; i < quantity; i += 1) {
        const hi = frame[3 + i * 2] ?? 0;
        const lo = frame[4 + i * 2] ?? 0;
        values.push((hi << 8) | lo);
      }
      return ok({ kind: "read", values });
    }
    // 写正常响应：echo address + quantity（固定 8 字节）。
    if (frame.length !== 8) {
      return fail(
        customError(
          "CUSTOM_INVALID_LENGTH",
          `write frame must be 8 bytes, got ${frame.length}`,
        ),
      );
    }
    const respAddress = ((frame[2] ?? 0) << 8) | (frame[3] ?? 0);
    const respQuantity = ((frame[4] ?? 0) << 8) | (frame[5] ?? 0);
    const expectedAddress = expect.request.entries[0]?.address ?? 0;
    const expectedQuantity = expect.request.entries.length;
    if (respAddress !== expectedAddress || respQuantity !== expectedQuantity) {
      return fail(
        customError(
          "CUSTOM_ECHO_MISMATCH",
          `echo mismatch: ${respAddress}/${respQuantity} != ${expectedAddress}/${expectedQuantity}`,
        ),
      );
    }
    return ok({ kind: "write" });
  }

  /** RTU 式期望长度分帧 + 从站地址重同步 + CRC 校验。 */
  parserFactory(expect: CodecExpect): FrameParser {
    const expectedSlave = expect.request.slaveAddress & 0xff;
    const expectedFunction =
      expect.kind === "read" ? CUSTOM_READ_FUNCTION : CUSTOM_WRITE_FUNCTION;
    const lengths = this.expectedLength(expect.kind, expect);
    let buffer: number[] = [];

    const tryParse = ():
      | { done: false }
      | {
          done: true;
          outcome: Result<CodecDecodedResponse>;
          frame: Uint8Array;
        } => {
      while (true) {
        const slaveIdx = buffer.indexOf(expectedSlave);
        if (slaveIdx === -1) {
          buffer = [];
          return { done: false };
        }
        if (slaveIdx > 0) buffer = buffer.slice(slaveIdx);
        if (buffer.length < 2) return { done: false };
        const functionByte = buffer[1] ?? -1;
        let frameLength: number;
        if (functionByte === expectedFunction) {
          frameLength = lengths.normal;
        } else if (functionByte === (expectedFunction | 0x80)) {
          frameLength = lengths.exception;
        } else {
          buffer.shift();
          continue;
        }
        if (buffer.length < frameLength) return { done: false };
        const frame = Uint8Array.from(buffer.slice(0, frameLength));
        const frameCrc = crc16Modbus(frame);
        if (frameCrc !== 0) {
          buffer.shift();
          continue;
        }
        const outcome = this.decodeResponse(frame, expect);
        if (outcome.ok) {
          buffer = buffer.slice(frameLength);
          return { done: true, outcome, frame };
        }
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
      return { normal: 3 + quantity * 2 + 2, exception: 5 };
    }
    return { normal: 8, exception: 5 };
  }
}
