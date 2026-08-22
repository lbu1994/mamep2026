/**
 * Modbus TCP ADU（MBAP + PDU）编解码（docs/TECH_DESIGN.md §34.3.16、ADR-020 后续 Node TCP Adapter）。
 * 仅 MVP 范围：FC03 读单个保持寄存器、FC0x10 写单个保持寄存器（与 rtu-frame.ts 对齐）。
 *
 * MBAP 头（7 字节）：
 * - transactionId(2) + protocolId(2, 恒为 0x0000) + length(2, 其后字节数 = unitId+PDU) + unitId(1)
 * TCP 无 CRC（与 RTU 的关键差异）。
 *
 * 本包只处理帧编解码；TCP 流的分帧/缓冲（deframer）与传输打开属通信/适配层职责。
 */
import { createMamepError, type MamepError } from "@mamep2026/domain";
import type { Result } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import {
  FUNCTION_READ_HOLDING,
  FUNCTION_WRITE_MULTIPLE,
} from "./rtu-frame";

export const PROTOCOL_IDENTIFIER = 0x0000;

export interface TcpReadHoldingRegistersRequest {
  transactionId: number;
  unitId: number;
  startAddress: number;
  quantity: number;
}

export interface TcpWriteSingleRegisterRequest {
  transactionId: number;
  unitId: number;
  address: number;
  rawValue: number;
}

/** 期望的响应类型：解码时据此做一致性校验（与 rtu-frame 的 ExpectedResponse 对齐）。 */
export type TcpExpectedResponse =
  | {
      kind: "read-holding";
      transactionId: number;
      unitId: number;
      startAddress: number;
      quantity: number;
    }
  | {
      kind: "write-single";
      transactionId: number;
      unitId: number;
      address: number;
      quantity: number;
    };

export type DecodedTcpResponse =
  | { kind: "read-holding"; values: number[] }
  | { kind: "write-single" }
  | { kind: "exception"; exceptionCode: number };

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

/** 组 MBAP 头 + PDU 为完整 ADU。length = unitId(1) + pdu.length。 */
function buildTcpFrame(
  transactionId: number,
  unitId: number,
  pdu: Uint8Array,
): Uint8Array {
  const length = 1 + pdu.length;
  const frame = new Uint8Array(6 + length);
  frame[0] = (transactionId >> 8) & 0xff;
  frame[1] = transactionId & 0xff;
  frame[2] = (PROTOCOL_IDENTIFIER >> 8) & 0xff;
  frame[3] = PROTOCOL_IDENTIFIER & 0xff;
  frame[4] = (length >> 8) & 0xff;
  frame[5] = length & 0xff;
  frame[6] = unitId & 0xff;
  frame.set(pdu, 7);
  return frame;
}

export function encodeTcpReadHoldingRegistersRequest(
  request: TcpReadHoldingRegistersRequest,
): Uint8Array {
  const pdu = Uint8Array.from([
    FUNCTION_READ_HOLDING,
    (request.startAddress >> 8) & 0xff,
    request.startAddress & 0xff,
    (request.quantity >> 8) & 0xff,
    request.quantity & 0xff,
  ]);
  return buildTcpFrame(request.transactionId, request.unitId, pdu);
}

/** 即使只写一个寄存器也使用功能码 0x10（docs/AGENTS.md §5.1）。 */
export function encodeTcpWriteSingleRegisterRequest(
  request: TcpWriteSingleRegisterRequest,
): Uint8Array {
  const pdu = Uint8Array.from([
    FUNCTION_WRITE_MULTIPLE,
    (request.address >> 8) & 0xff,
    request.address & 0xff,
    0x00,
    0x01, // quantity = 1
    0x02, // byte count = 2
    (request.rawValue >> 8) & 0xff,
    request.rawValue & 0xff,
  ]);
  return buildTcpFrame(request.transactionId, request.unitId, pdu);
}

/** 解码 TCP 响应 ADU。MBAP 头 7 字节 + PDU；严格长度校验（长度字段与实收一致）。 */
export function decodeTcpResponse(
  frame: Uint8Array,
  expected: TcpExpectedResponse,
): Result<DecodedTcpResponse> {
  // 最小帧：MBAP(7) + fc(1)。
  if (frame.length < 8) {
    return fail(
      protocolError(
        "TCP_INVALID_LENGTH",
        `frame too short: ${frame.length} bytes`,
      ),
    );
  }

  const protocolId = ((frame[2] ?? 0) << 8) | (frame[3] ?? 0);
  if (protocolId !== PROTOCOL_IDENTIFIER) {
    return fail(
      protocolError(
        "TCP_PROTOCOL_MISMATCH",
        `protocol identifier expected ${PROTOCOL_IDENTIFIER}, got ${protocolId}`,
      ),
    );
  }

  const declaredLength = ((frame[4] ?? 0) << 8) | (frame[5] ?? 0);
  // 总帧长 = 6（txn/proto/length 字段）+ length 字段值（unitId + PDU）。
  if (frame.length !== 6 + declaredLength) {
    return fail(
      protocolError(
        "TCP_INVALID_LENGTH",
        `frame length ${frame.length} does not match MBAP length ${declaredLength}`,
      ),
    );
  }

  const transactionId = ((frame[0] ?? 0) << 8) | (frame[1] ?? 0);
  if (transactionId !== expected.transactionId) {
    return fail(
      protocolError(
        "TCP_TRANSACTION_MISMATCH",
        `transaction id expected ${expected.transactionId}, got ${transactionId}`,
      ),
    );
  }

  const unitId = frame[6] ?? -1;
  if (unitId !== expected.unitId) {
    return fail(
      protocolError(
        "TCP_UNIT_ID_MISMATCH",
        `unit id expected ${expected.unitId}, got ${unitId}`,
      ),
    );
  }

  const functionCode = frame[7] ?? -1;
  const expectedFunction =
    expected.kind === "read-holding"
      ? FUNCTION_READ_HOLDING
      : FUNCTION_WRITE_MULTIPLE;

  // 异常响应：功能码最高位置 1。
  if (
    (functionCode & 0x7f) === expectedFunction &&
    (functionCode & 0x80) !== 0
  ) {
    // 异常响应：MBAP(7) + fc|0x80(1) + exceptionCode(1) = 9 字节。
    if (frame.length !== 9) {
      return fail(
        protocolError(
          "TCP_INVALID_LENGTH",
          `exception frame must be 9 bytes, got ${frame.length}`,
        ),
      );
    }
    return ok({ kind: "exception", exceptionCode: frame[8] ?? 0 });
  }

  if (functionCode !== expectedFunction) {
    return fail(
      protocolError(
        "TCP_FUNCTION_MISMATCH",
        `function mismatch: expected ${expectedFunction.toString(16)}, got ${functionCode.toString(16)}`,
      ),
    );
  }

  if (expected.kind === "read-holding") {
    // 正常读响应：MBAP(7) + fc(1) + byteCount(1) + data(quantity*2)。
    if (frame.length !== 9 + expected.quantity * 2) {
      return fail(
        protocolError(
          "TCP_INVALID_LENGTH",
          `read frame must be ${9 + expected.quantity * 2} bytes, got ${frame.length}`,
        ),
      );
    }
    const byteCount = frame[8] ?? -1;
    if (byteCount !== expected.quantity * 2) {
      return fail(
        protocolError(
          "TCP_BYTE_COUNT_MISMATCH",
          `byte count expected ${expected.quantity * 2}, got ${byteCount}`,
        ),
      );
    }
    const values: number[] = [];
    for (let i = 0; i < expected.quantity; i++) {
      const hi = frame[9 + i * 2];
      const lo = frame[10 + i * 2];
      if (hi === undefined || lo === undefined) {
        return fail(
          protocolError(
            "TCP_DATA_LENGTH_MISMATCH",
            "read response data truncated",
          ),
        );
      }
      values.push((hi << 8) | lo);
    }
    return ok({ kind: "read-holding", values });
  }

  // write-single 响应：MBAP(7) + fc(1) + address(2) + quantity(2) = 12 字节。
  if (frame.length !== 12) {
    return fail(
      protocolError(
        "TCP_INVALID_LENGTH",
        `write frame must be 12 bytes, got ${frame.length}`,
      ),
    );
  }
  const respAddress = ((frame[8] ?? 0) << 8) | (frame[9] ?? 0);
  if (respAddress !== expected.address) {
    return fail(
      protocolError(
        "TCP_ADDRESS_MISMATCH",
        `address expected ${expected.address}, got ${respAddress}`,
      ),
    );
  }
  const respQuantity = ((frame[10] ?? 0) << 8) | (frame[11] ?? 0);
  if (respQuantity !== expected.quantity) {
    return fail(
      protocolError(
        "TCP_QUANTITY_MISMATCH",
        `quantity expected ${expected.quantity}, got ${respQuantity}`,
      ),
    );
  }
  return ok({ kind: "write-single" });
}
