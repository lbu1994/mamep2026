/**
 * Modbus RTU ADU 编解码（FC03 读保持寄存器（quantity 可 >1）、FC0x10 写保持寄存器（单值或多值））。
 *
 * 帧结构：
 * - FC03 正常响应：slave(1) + fc(1) + byteCount(1) + data(quantity*2) + crc(2)
 * - FC0x10 正常响应：slave(1) + fc(1) + startAddr(2) + quantity(2) + crc(2) = 8 字节
 * - 异常响应：slave(1) + fc|0x80(1) + exceptionCode(1) + crc(2) = 5 字节
 *
 * 多寄存器（ADR-030，2026-08-27）：读路径 quantity 任意（≤ MAX_READ_QUANTITY）；写路径支持
 * 单值（WriteSingleRegisterRequest，FC0x10 quantity=1）与多值（WriteMultipleRegistersRequest，
 * FC0x10 quantity=N、byteCount=2N、值大端）。
 *
 * 本包只处理最终已验证的实际发送地址，不了解 Address Adjust（docs/TECH_DESIGN.md §17.3）。
 */
import { createMamepError, type MamepError } from "@mamep2026/domain";
import type { Result } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import { appendCrc, crc16Modbus } from "./crc16";

export const FUNCTION_READ_HOLDING = 0x03;
export const FUNCTION_WRITE_MULTIPLE = 0x10;

export const EXCEPTION_ILLEGAL_FUNCTION = 0x01;
export const EXCEPTION_ILLEGAL_DATA_ADDRESS = 0x02;
export const EXCEPTION_ILLEGAL_DATA_VALUE = 0x03;

/** RTU 单次请求最大读取寄存器数（ADU≤256B → PDU≤253B：1+1+2q+2 ≤ 253 → q ≤ 125，ADR-030）。 */
export const MAX_READ_QUANTITY = 125;
/** RTU 单次请求最大写入寄存器数（1+1+2+2+1+2q ≤ 253 → q ≤ 123，ADR-030）。 */
export const MAX_WRITE_QUANTITY = 123;

export interface ReadHoldingRegistersRequest {
  slaveAddress: number;
  startAddress: number;
  quantity: number;
}

export interface WriteSingleRegisterRequest {
  slaveAddress: number;
  address: number;
  rawValue: number;
}

/** FC0x10 多寄存器写入（ADR-030）：一次请求写多个连续寄存器（quantity = values.length）。 */
export interface WriteMultipleRegistersRequest {
  slaveAddress: number;
  startAddress: number;
  values: number[];
}

/** 期望的响应类型：解码时据此做一致性校验（docs/AGENTS.md §10.2）。 */
export type ExpectedResponse =
  | {
      kind: "read-holding";
      slaveAddress: number;
      startAddress: number;
      quantity: number;
    }
  | {
      kind: "write-single";
      slaveAddress: number;
      address: number;
      quantity: number;
    }
  | {
      kind: "write-multiple";
      slaveAddress: number;
      address: number;
      quantity: number;
    };

export type DecodedRtuResponse =
  | { kind: "read-holding"; values: number[] }
  | { kind: "write-single" }
  | { kind: "write-multiple" }
  | { kind: "exception"; exceptionCode: number };

export function encodeReadHoldingRegistersRequest(
  request: ReadHoldingRegistersRequest,
): Uint8Array {
  const body = Uint8Array.from([
    request.slaveAddress & 0xff,
    FUNCTION_READ_HOLDING,
    (request.startAddress >> 8) & 0xff,
    request.startAddress & 0xff,
    (request.quantity >> 8) & 0xff,
    request.quantity & 0xff,
  ]);
  return appendCrc(body);
}

/** 即使只写一个寄存器也使用功能码 0x10（docs/AGENTS.md §5.1）。 */
export function encodeWriteSingleRegisterRequest(
  request: WriteSingleRegisterRequest,
): Uint8Array {
  const body = Uint8Array.from([
    request.slaveAddress & 0xff,
    FUNCTION_WRITE_MULTIPLE,
    (request.address >> 8) & 0xff,
    request.address & 0xff,
    0x00,
    0x01, // quantity = 1
    0x02, // byte count = 2
    (request.rawValue >> 8) & 0xff,
    request.rawValue & 0xff,
  ]);
  return appendCrc(body);
}

/** FC0x10 多寄存器写入（ADR-030）：quantity = values.length、byteCount = 2N、值大端。 */
export function encodeWriteMultipleRegistersRequest(
  request: WriteMultipleRegistersRequest,
): Uint8Array {
  const quantity = request.values.length;
  const byteCount = quantity * 2;
  const body = new Uint8Array(7 + byteCount);
  body[0] = request.slaveAddress & 0xff;
  body[1] = FUNCTION_WRITE_MULTIPLE;
  body[2] = (request.startAddress >> 8) & 0xff;
  body[3] = request.startAddress & 0xff;
  body[4] = (quantity >> 8) & 0xff;
  body[5] = quantity & 0xff;
  body[6] = byteCount & 0xff;
  for (let i = 0; i < quantity; i++) {
    const value = request.values[i] ?? 0;
    body[7 + i * 2] = (value >> 8) & 0xff;
    body[8 + i * 2] = value & 0xff;
  }
  return appendCrc(body);
}

export function expectedResponseLength(
  kind: ExpectedResponse["kind"],
  quantity = 1,
): { normal: number; exception: number } {
  if (kind === "read-holding") {
    return { normal: 3 + quantity * 2 + 2, exception: 5 };
  }
  return { normal: 8, exception: 5 };
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

export function decodeRtuResponse(
  frame: Uint8Array,
  expected: ExpectedResponse,
): Result<DecodedRtuResponse> {
  if (frame.length < 4) {
    return fail(
      protocolError(
        "RTU_INVALID_LENGTH",
        `frame too short: ${frame.length} bytes`,
      ),
    );
  }

  // CRC 校验（对除 CRC 本身外的全部字节）。
  const bodyLength = frame.length - 2;
  const expectedCrc = crc16Modbus(frame, 0, bodyLength);
  const actualCrc =
    (frame[bodyLength] ?? 0) | ((frame[bodyLength + 1] ?? 0) << 8);
  if (actualCrc !== expectedCrc) {
    return fail(
      protocolError(
        "RTU_CRC_MISMATCH",
        `crc mismatch: expected ${expectedCrc.toString(16)}, got ${actualCrc.toString(16)}`,
      ),
    );
  }

  const slaveAddress = frame[0] ?? -1;
  if (slaveAddress !== expected.slaveAddress) {
    return fail(
      protocolError(
        "RTU_SLAVE_MISMATCH",
        `slave mismatch: expected ${expected.slaveAddress}, got ${slaveAddress}`,
      ),
    );
  }

  const functionCode = frame[1] ?? -1;

  // 异常响应：功能码最高位置 1。
  const expectedFunction =
    expected.kind === "read-holding"
      ? FUNCTION_READ_HOLDING
      : FUNCTION_WRITE_MULTIPLE;
  if (
    (functionCode & 0x7f) === expectedFunction &&
    (functionCode & 0x80) !== 0
  ) {
    if (frame.length !== 5) {
      return fail(
        protocolError(
          "RTU_INVALID_LENGTH",
          `exception frame must be 5 bytes, got ${frame.length}`,
        ),
      );
    }
    return ok({ kind: "exception", exceptionCode: frame[2] ?? 0 });
  }

  if (functionCode !== expectedFunction) {
    return fail(
      protocolError(
        "RTU_FUNCTION_MISMATCH",
        `function mismatch: expected ${expectedFunction.toString(16)}, got ${functionCode.toString(16)}`,
      ),
    );
  }

  if (expected.kind === "read-holding") {
    if (frame.length !== 5 + expected.quantity * 2) {
      return fail(
        protocolError(
          "RTU_INVALID_LENGTH",
          `read frame must be ${5 + expected.quantity * 2} bytes, got ${frame.length}`,
        ),
      );
    }
    const byteCount = frame[2] ?? -1;
    if (byteCount !== expected.quantity * 2) {
      return fail(
        protocolError(
          "RTU_BYTE_COUNT_MISMATCH",
          `byte count expected ${expected.quantity * 2}, got ${byteCount}`,
        ),
      );
    }
    const values: number[] = [];
    for (let i = 0; i < expected.quantity; i++) {
      const hi = frame[3 + i * 2];
      const lo = frame[4 + i * 2];
      if (hi === undefined || lo === undefined) {
        return fail(
          protocolError(
            "RTU_DATA_LENGTH_MISMATCH",
            "read response data truncated",
          ),
        );
      }
      values.push((hi << 8) | lo);
    }
    return ok({ kind: "read-holding", values });
  }

  // write-single / write-multiple 响应：回执 address + quantity（固定 8 字节）。
  if (frame.length !== 8) {
    return fail(
      protocolError(
        "RTU_INVALID_LENGTH",
        `write frame must be 8 bytes, got ${frame.length}`,
      ),
    );
  }
  const respAddress = ((frame[2] ?? 0) << 8) | (frame[3] ?? 0);
  if (respAddress !== expected.address) {
    return fail(
      protocolError(
        "RTU_ADDRESS_MISMATCH",
        `address expected ${expected.address}, got ${respAddress}`,
      ),
    );
  }
  const respQuantity = ((frame[4] ?? 0) << 8) | (frame[5] ?? 0);
  if (respQuantity !== expected.quantity) {
    return fail(
      protocolError(
        "RTU_QUANTITY_MISMATCH",
        `quantity expected ${expected.quantity}, got ${respQuantity}`,
      ),
    );
  }
  return ok({
    kind: expected.kind === "write-multiple" ? "write-multiple" : "write-single",
  });
}
