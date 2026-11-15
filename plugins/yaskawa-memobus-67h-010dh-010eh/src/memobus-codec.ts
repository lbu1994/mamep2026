/**
 * 安川 MEMOBUS 协议编解码器（插件）。
 * 实现功能码 67 + 辅助功能码 010D（非连续读 ≤120）/ 010E（非连续写 ≤60）。
 * 帧结构见 docs/安川MEMOBUS公开协议参考.md §1~§2。
 *
 * 纯 TS、独立于核心 Modbus：不进 protocol-modbus、不 import 其符号（AGENTS §5.3/§10.1），
 * CRC-16 自带实现（标准 CRC-16/MODBUS，用户已确认与手册向量一致）。
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
import { appendCrc, verifyCrc } from "./crc16";

/** 功能码 67：非连续读写（手册 §1/§2）。 */
export const MEMOBUS_FUNCTION = 0x67;
/** 辅助功能码：非连续读。 */
export const MEMOBUS_SUB_READ = 0x010d;
/** 辅助功能码：非连续写。 */
export const MEMOBUS_SUB_WRITE = 0x010e;
/** 非连续读数量上限（手册表 6.20 错误码 03 说明：1~120）。 */
export const MEMOBUS_MAX_READ = 120;
/** 非连续写数量上限（手册表 6.20 错误码 03 说明：1~60）。 */
export const MEMOBUS_MAX_WRITE = 60;

function memobusError(code: string, technicalMessage: string): MamepError {
  return createMamepError({
    code,
    category: "modbus-exception",
    severity: "warning",
    retryable: false,
    userMessageKey: "errors.modbusException",
    technicalMessage,
  });
}

/** 从 CodecExpect 提取单元地址（RTU 类承载 = 从站地址）。 */
function slaveOf(expect: CodecExpect): number {
  return expect.request.slaveAddress;
}

export class MemobusCodec implements ProtocolCodec {
  readonly protocolId = "yaskawa-memobus-67h-010dh-010eh";
  readonly maxRead = MEMOBUS_MAX_READ;
  readonly maxWrite = MEMOBUS_MAX_WRITE;

  /** 67/010D：slave + 67 + 010D + 数据个数(2) + 寄存器编号×N + CRC-16。 */
  encodeRead(req: CodecReadRequest): Uint8Array {
    const count = req.addresses.length;
    if (count < 1 || count > MEMOBUS_MAX_READ) {
      throw memobusError(
        "MEMOBUS_QUANTITY_OUT_OF_RANGE",
        `memobus read count out of range: ${count}`,
      );
    }
    const body = new Uint8Array(6 + count * 2);
    body[0] = req.slaveAddress & 0xff;
    body[1] = MEMOBUS_FUNCTION;
    body[2] = 0x01;
    body[3] = MEMOBUS_SUB_READ & 0xff;
    body[4] = (count >> 8) & 0xff;
    body[5] = count & 0xff;
    for (let i = 0; i < count; i += 1) {
      const address = req.addresses[i] ?? 0;
      body[6 + i * 2] = (address >> 8) & 0xff;
      body[7 + i * 2] = address & 0xff;
    }
    return appendCrc(body);
  }

  /** 67/010E：slave + 67 + 010E + 数据个数(2) + 字节数(2，＝个数×2) + （编号+数据）×N + CRC-16。 */
  encodeWrite(req: CodecWriteRequest): Uint8Array {
    const count = req.entries.length;
    if (count < 1 || count > MEMOBUS_MAX_WRITE) {
      throw memobusError(
        "MEMOBUS_QUANTITY_OUT_OF_RANGE",
        `memobus write count out of range: ${count}`,
      );
    }
    const body = new Uint8Array(8 + count * 4);
    body[0] = req.slaveAddress & 0xff;
    body[1] = MEMOBUS_FUNCTION;
    body[2] = 0x01;
    body[3] = MEMOBUS_SUB_WRITE & 0xff;
    body[4] = (count >> 8) & 0xff;
    body[5] = count & 0xff;
    body[6] = 0x00;
    body[7] = (count * 2) & 0xff; // 字节数 = 数据个数 × 2（手册 §2.1 注）。
    for (let i = 0; i < count; i += 1) {
      const entry = req.entries[i];
      if (entry === undefined) continue;
      body[8 + i * 4] = (entry.address >> 8) & 0xff;
      body[9 + i * 4] = entry.address & 0xff;
      body[10 + i * 4] = (entry.value >> 8) & 0xff;
      body[11 + i * 4] = entry.value & 0xff;
    }
    return appendCrc(body);
  }

  /**
   * 解码响应（CRC 由 parser 校验后调用；本方法做语义一致性校验，对齐 AGENTS §10.2）。
   * 异常响应：slave + E7 + 错误代码 + CRC-16（5 字节）。
   */
  decodeResponse(
    frame: Uint8Array,
    expect: CodecExpect,
  ): Result<CodecDecodedResponse> {
    if (frame.length < 5) {
      return fail(
        memobusError(
          "MEMOBUS_FRAME_TOO_SHORT",
          `frame too short: ${frame.length}`,
        ),
      );
    }
    const slaveAddress = frame[0] ?? 0;
    const functionCode = frame[1] ?? 0;
    if (slaveAddress !== slaveOf(expect)) {
      return fail(
        memobusError(
          "MEMOBUS_SLAVE_MISMATCH",
          `slave address mismatch: ${slaveAddress} != ${slaveOf(expect)}`,
        ),
      );
    }
    if (functionCode === (MEMOBUS_FUNCTION | 0x80)) {
      return ok({ kind: "exception", exceptionCode: frame[2] ?? 0 });
    }
    if (functionCode !== MEMOBUS_FUNCTION) {
      return fail(
        memobusError(
          "MEMOBUS_FUNCTION_MISMATCH",
          `function code mismatch: ${functionCode.toString(16)}`,
        ),
      );
    }
    const sub = ((frame[2] ?? 0) << 8) | (frame[3] ?? 0);
    const expectedSub =
      expect.kind === "read" ? MEMOBUS_SUB_READ : MEMOBUS_SUB_WRITE;
    if (sub !== expectedSub) {
      return fail(
        memobusError(
          "MEMOBUS_SUB_FUNCTION_MISMATCH",
          `sub function mismatch: ${sub.toString(16)}`,
        ),
      );
    }
    if (expect.kind === "read") {
      const byteCount = ((frame[4] ?? 0) << 8) | (frame[5] ?? 0);
      const count = expect.request.addresses.length;
      if (byteCount !== count * 2) {
        return fail(
          memobusError(
            "MEMOBUS_BYTE_COUNT_MISMATCH",
            `byte count mismatch: ${byteCount} != ${count * 2}`,
          ),
        );
      }
      const values: number[] = [];
      for (let i = 0; i < count; i += 1) {
        const hi = frame[6 + i * 2] ?? 0;
        const lo = frame[7 + i * 2] ?? 0;
        values.push((hi << 8) | lo);
      }
      return ok({ kind: "read", values });
    }
    // 写正常响应：slave + 67 + 010E + 数据个数(2) + CRC-16（8 字节，不回显字节数/数据）。
    const count = ((frame[4] ?? 0) << 8) | (frame[5] ?? 0);
    if (count !== expect.request.entries.length) {
      return fail(
        memobusError(
          "MEMOBUS_COUNT_MISMATCH",
          `data count mismatch: ${count} != ${expect.request.entries.length}`,
        ),
      );
    }
    return ok({ kind: "write" });
  }

  /** RTU 式期望长度分帧 + CRC 校验 + 噪声重同步（对齐 RtuFrameParser 语义）。 */
  parserFactory(expect: CodecExpect): FrameParser {
    const expectedSlave = slaveOf(expect) & 0xff;
    const lengths = this.expectedLength(expect.kind, expect);
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
        if (functionByte === MEMOBUS_FUNCTION) {
          frameLength = lengths.normal;
        } else if (functionByte === (MEMOBUS_FUNCTION | 0x80)) {
          frameLength = lengths.exception;
        } else {
          // 噪声字节：丢弃后重新同步。
          buffer.shift();
          continue;
        }
        if (buffer.length < frameLength) return { done: false };
        const frame = Uint8Array.from(buffer.slice(0, frameLength));
        if (!verifyCrc(frame)) {
          // CRC 损坏：丢弃首字节继续尝试同步，最终由超时兜底。
          buffer.shift();
          continue;
        }
        buffer = buffer.slice(frameLength);
        const outcome = this.decodeResponse(frame, expect);
        if (outcome.ok) {
          return { done: true, outcome, frame };
        }
        // 完整帧语义校验失败（字节数/个数不匹配等）：丢弃首字节重同步。
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

  expectedLength(_kind: "read" | "write", expect: CodecExpect) {
    // 帧长以 expect.kind 为准（接口保留 kind 形参以对齐 ProtocolCodec 签名）。
    if (expect.kind === "read") {
      // 正常读帧：slave+fc+sub(4) + byteCount(2) + data(2N) + crc(2) = 8 + 2N。
      return {
        normal: 8 + expect.request.addresses.length * 2,
        exception: 5,
      };
    }
    // 正常写帧：slave+fc+sub(4) + count(2) + crc(2) = 8。
    return { normal: 8, exception: 5 };
  }

  /** 异常响应 → MEMOBUS_EXCEPTION_XX（category 沿用设备异常语义）。 */
  mapException(exceptionCode: number): MamepError {
    return memobusError(
      `MEMOBUS_EXCEPTION_${exceptionCode.toString(16).toUpperCase().padStart(2, "0")}`,
      `memobus exception code ${exceptionCode}`,
    );
  }
}
