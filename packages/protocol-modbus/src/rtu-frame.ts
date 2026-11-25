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
import { fail } from "@mamep2026/domain";
import { appendCrc, crc16Modbus } from "./crc16";

import {
  decodeResponsePdu,
  encodeReadPdu,
  encodeWritePdu,
  FUNCTION_READ_HOLDING,
  FUNCTION_READ_INPUT_REGISTERS,
  FUNCTION_WRITE_MULTIPLE,
  FUNCTION_WRITE_MULTIPLE_COILS,
  isBitPackedRead,
  type PduExpectedResponse,
  type DecodedPduResponse,
} from "./pdu";
export * from "./pdu";

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
export type ExpectedResponse = PduExpectedResponse & { slaveAddress: number };
export type DecodedRtuResponse = DecodedPduResponse;

/** Wrap a PDU with a slave address and CRC. */
function buildRtuFrame(slaveAddress: number, pdu: Uint8Array): Uint8Array {
  return appendCrc(Uint8Array.from([slaveAddress, ...pdu]));
}

export function encodeReadHoldingRegistersRequest(
  request: ReadHoldingRegistersRequest,
): Uint8Array {
  return buildRtuFrame(
    request.slaveAddress,
    encodeReadPdu(
      FUNCTION_READ_HOLDING,
      request.startAddress,
      request.quantity,
    ),
  );
}

/** FC01/FC02 读位（线圈/离散输入）：请求帧与 FC03 同构。 */
export function encodeReadBitsRequest(
  request: ReadBitsRequest,
  functionCode: number,
): Uint8Array {
  return buildRtuFrame(
    request.slaveAddress,
    encodeReadPdu(functionCode, request.startAddress, request.quantity),
  );
}

/** FC04 读输入寄存器：请求帧与 FC03 同构。 */
export function encodeReadInputRegistersRequest(
  request: ReadInputRegistersRequest,
): Uint8Array {
  return buildRtuFrame(
    request.slaveAddress,
    encodeReadPdu(
      FUNCTION_READ_INPUT_REGISTERS,
      request.startAddress,
      request.quantity,
    ),
  );
}

/**
 * FC0F 写多线圈：values 为 0/1，位打包（byteCount=ceil(n/8)，字节内 LSB 在前），
 * 末字节高位补 0。
 */
export function encodeWriteMultipleCoilsRequest(
  request: WriteMultipleCoilsRequest,
): Uint8Array {
  return buildRtuFrame(
    request.slaveAddress,
    encodeWritePdu(
      FUNCTION_WRITE_MULTIPLE_COILS,
      request.startAddress,
      request.values,
    ),
  );
}

/** 即使只写一个寄存器也使用功能码 0x10（docs/AGENTS.md §5.1）。 */
export function encodeWriteSingleRegisterRequest(
  request: WriteSingleRegisterRequest,
): Uint8Array {
  return buildRtuFrame(
    request.slaveAddress,
    encodeWritePdu(FUNCTION_WRITE_MULTIPLE, request.address, [
      request.rawValue,
    ]),
  );
}

/** FC0x10 多寄存器写入：quantity = values.length、byteCount = 2N、值大端。 */
export function encodeWriteMultipleRegistersRequest(
  request: WriteMultipleRegistersRequest,
): Uint8Array {
  return buildRtuFrame(
    request.slaveAddress,
    encodeWritePdu(
      FUNCTION_WRITE_MULTIPLE,
      request.startAddress,
      request.values,
    ),
  );
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

  return decodeResponsePdu(
    frame.subarray(1, frame.length - 2),
    expected,
    "RTU",
  );
}
