/**
 * Modbus RTU ADU 编解码（FC03 读保持寄存器（quantity 可 >1）、FC0x10 写保持寄存器（单值或多值）、
 * FC01/FC02/FC04/FC0F 基础表（线圈/离散输入/输入寄存器））。
 *
 * 帧结构：
 * - FC03/FC04 正常响应：slave(1) + fc(1) + byteCount(1) + data(quantity*2) + crc(2)
 * - FC01/FC02 正常响应：slave(1) + fc(1) + byteCount(1) + data(ceil(quantity/8)) + crc(2)
 * - FC0x10/FC0F 正常响应：slave(1) + fc(1) + startAddr(2) + quantity(2) + crc(2) = 8 字节
 * - 异常响应：slave(1) + fc|0x80(1) + exceptionCode(1) + crc(2) = 5 字节
 *
 * 多寄存器：读路径 quantity 任意（≤ MAX_READ_QUANTITY）；写路径支持
 * 单值（WriteSingleRegisterRequest，FC0x10 quantity=1）与多值（WriteMultipleRegistersRequest，
 * FC0x10 quantity=N、byteCount=2N、值大端）。
 * 基础表：FC01/FC02 位打包（byteCount=ceil(q/8)，字节内 LSB 在前）；
 * FC0F 写多线圈同理位打包；FC04 与 FC03 同构（16 位寄存器）。
 *
 * 本包只处理最终已验证的实际发送地址，不了解 Address Adjust（docs/TECH_DESIGN.md §17.3）。
 */
import { createMamepError, type MamepError } from "@mamep2026/domain";
import type { Result } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import { appendCrc, crc16Modbus } from "./crc16";

export const FUNCTION_READ_COILS = 0x01;
export const FUNCTION_READ_DISCRETE_INPUTS = 0x02;
export const FUNCTION_READ_HOLDING = 0x03;
export const FUNCTION_READ_INPUT_REGISTERS = 0x04;
export const FUNCTION_WRITE_MULTIPLE_COILS = 0x0f;
export const FUNCTION_WRITE_MULTIPLE = 0x10;

export const EXCEPTION_ILLEGAL_FUNCTION = 0x01;
export const EXCEPTION_ILLEGAL_DATA_ADDRESS = 0x02;
export const EXCEPTION_ILLEGAL_DATA_VALUE = 0x03;

/** RTU 单次请求最大读取寄存器数（ADU≤256B → PDU≤253B：1+1+2q+2 ≤ 253 → q ≤ 125）。 */
export const MAX_READ_QUANTITY = 125;
/** RTU 单次请求最大写入寄存器数（1+1+2+2+1+2q ≤ 253 → q ≤ 123）。 */
export const MAX_WRITE_QUANTITY = 123;
/** FC01/FC02 单次请求最大读取位（线圈/离散输入）数（Modbus 规范 2000）。 */
export const MAX_READ_BITS_QUANTITY = 2000;
/** FC0F 单次请求最大写入线圈数（Modbus 规范 1968）。 */
export const MAX_WRITE_COILS_QUANTITY = 1968;

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

/** FC0x10 多寄存器写入：一次请求写多个连续寄存器（quantity = values.length）。 */
export interface WriteMultipleRegistersRequest {
  slaveAddress: number;
  startAddress: number;
  values: number[];
}

/** FC01/FC02 读位（线圈/离散输入）：与 FC03 请求同构（slave+fc+addr+quantity）。 */
export interface ReadBitsRequest {
  slaveAddress: number;
  startAddress: number;
  quantity: number;
}

/** FC04 读输入寄存器：与 FC03 同构。 */
export interface ReadInputRegistersRequest {
  slaveAddress: number;
  startAddress: number;
  quantity: number;
}

/** FC0F 写多线圈：values 为 0/1（位打包，byteCount=ceil(n/8)，字节内 LSB 在前）。 */
export interface WriteMultipleCoilsRequest {
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
      kind: "read-coils";
      slaveAddress: number;
      startAddress: number;
      quantity: number;
    }
  | {
      kind: "read-discrete-inputs";
      slaveAddress: number;
      startAddress: number;
      quantity: number;
    }
  | {
      kind: "read-input-registers";
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
    }
  | {
      kind: "write-multiple-coils";
      slaveAddress: number;
      address: number;
      quantity: number;
    };

export type DecodedRtuResponse =
  | { kind: "read-holding"; values: number[] }
  | { kind: "read-coils"; values: number[] }
  | { kind: "read-discrete-inputs"; values: number[] }
  | { kind: "read-input-registers"; values: number[] }
  | { kind: "write-single" }
  | { kind: "write-multiple" }
  | { kind: "write-multiple-coils" }
  | { kind: "exception"; exceptionCode: number };

/** 读类 kind → 响应是否位打包（FC01/FC02 位打包；FC03/FC04 16 位）。 */
export function isBitPackedRead(kind: ExpectedResponse["kind"]): boolean {
  return kind === "read-coils" || kind === "read-discrete-inputs";
}

/** 期望 kind → 功能码（解码校验用）。 */
export function functionCodeForKind(kind: ExpectedResponse["kind"]): number {
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

/** FC01/FC02 读位（线圈/离散输入）：请求帧与 FC03 同构。 */
export function encodeReadBitsRequest(
  request: ReadBitsRequest,
  functionCode: number,
): Uint8Array {
  const body = Uint8Array.from([
    request.slaveAddress & 0xff,
    functionCode & 0xff,
    (request.startAddress >> 8) & 0xff,
    request.startAddress & 0xff,
    (request.quantity >> 8) & 0xff,
    request.quantity & 0xff,
  ]);
  return appendCrc(body);
}

/** FC04 读输入寄存器：请求帧与 FC03 同构。 */
export function encodeReadInputRegistersRequest(
  request: ReadInputRegistersRequest,
): Uint8Array {
  const body = Uint8Array.from([
    request.slaveAddress & 0xff,
    FUNCTION_READ_INPUT_REGISTERS,
    (request.startAddress >> 8) & 0xff,
    request.startAddress & 0xff,
    (request.quantity >> 8) & 0xff,
    request.quantity & 0xff,
  ]);
  return appendCrc(body);
}

/**
 * FC0F 写多线圈：values 为 0/1，位打包（byteCount=ceil(n/8)，字节内 LSB 在前），
 * 末字节高位补 0。
 */
export function encodeWriteMultipleCoilsRequest(
  request: WriteMultipleCoilsRequest,
): Uint8Array {
  const quantity = request.values.length;
  const byteCount = Math.ceil(quantity / 8);
  const body = new Uint8Array(7 + byteCount);
  body[0] = request.slaveAddress & 0xff;
  body[1] = FUNCTION_WRITE_MULTIPLE_COILS;
  body[2] = (request.startAddress >> 8) & 0xff;
  body[3] = request.startAddress & 0xff;
  body[4] = (quantity >> 8) & 0xff;
  body[5] = quantity & 0xff;
  body[6] = byteCount & 0xff;
  for (let i = 0; i < quantity; i++) {
    const value = request.values[i] ?? 0;
    if (value !== 0) {
      const index = 7 + (i >> 3);
      body[index] = (body[index] ?? 0) | (1 << (i & 7));
    }
  }
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

/** FC0x10 多寄存器写入：quantity = values.length、byteCount = 2N、值大端。 */
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
  if (isBitPackedRead(kind)) {
    return { normal: 3 + Math.ceil(quantity / 8) + 2, exception: 5 };
  }
  if (kind === "read-holding" || kind === "read-input-registers") {
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
  const expectedFunction = functionCodeForKind(expected.kind);
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

  // 读类响应（FC03/FC04 16 位；FC01/FC02 位打包）。
  if (
    expected.kind === "read-holding" ||
    expected.kind === "read-input-registers" ||
    expected.kind === "read-coils" ||
    expected.kind === "read-discrete-inputs"
  ) {
    const dataBytes = isBitPackedRead(expected.kind)
      ? Math.ceil(expected.quantity / 8)
      : expected.quantity * 2;
    if (frame.length !== 3 + dataBytes + 2) {
      return fail(
        protocolError(
          "RTU_INVALID_LENGTH",
          `read frame must be ${3 + dataBytes + 2} bytes, got ${frame.length}`,
        ),
      );
    }
    const byteCount = frame[2] ?? -1;
    if (byteCount !== dataBytes) {
      return fail(
        protocolError(
          "RTU_BYTE_COUNT_MISMATCH",
          `byte count expected ${dataBytes}, got ${byteCount}`,
        ),
      );
    }
    // 位打包：逐位解包为 0/1（字节内 LSB 在前）。
    const values: number[] = [];
    for (let i = 0; i < expected.quantity; i++) {
      if (isBitPackedRead(expected.kind)) {
        const byte = frame[3 + (i >> 3)];
        values.push(byte === undefined ? 0 : (byte >> (i & 7)) & 1);
      } else {
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
    }
    const kind =
      expected.kind === "read-holding"
        ? "read-holding"
        : expected.kind === "read-input-registers"
          ? "read-input-registers"
          : expected.kind === "read-coils"
            ? "read-coils"
            : "read-discrete-inputs";
    return ok({ kind, values } as DecodedRtuResponse);
  }

  // write-single / write-multiple / write-multiple-coils 响应：回执 address + quantity（固定 8 字节）。
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
  const kind =
    expected.kind === "write-multiple-coils"
      ? "write-multiple-coils"
      : expected.kind === "write-multiple"
        ? "write-multiple"
        : "write-single";
  return ok({ kind } as DecodedRtuResponse);
}
