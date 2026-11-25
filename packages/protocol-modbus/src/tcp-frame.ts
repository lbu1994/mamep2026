/**
 * Modbus TCP ADU encoding and decoding for FC01/02/03/04/0F/10.
 * MBAP contains transaction ID, protocol ID, length and Unit ID; TCP has no CRC.
 * PDU semantics are shared with RTU. Stream buffering belongs to communication.
 */
import { createMamepError, type MamepError } from "@mamep2026/domain";
import type { Result } from "@mamep2026/domain";
import { fail } from "@mamep2026/domain";
import {
  decodeResponsePdu,
  encodeReadPdu,
  encodeWritePdu,
  FUNCTION_READ_HOLDING,
  FUNCTION_READ_INPUT_REGISTERS,
  FUNCTION_WRITE_MULTIPLE,
  FUNCTION_WRITE_MULTIPLE_COILS,
  type PduExpectedResponse,
  type DecodedPduResponse,
} from "./pdu";

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

/** FC0x10 多寄存器写入（TCP）：一次请求写多个连续寄存器（quantity = values.length）。 */
export interface TcpWriteMultipleRegistersRequest {
  transactionId: number;
  unitId: number;
  startAddress: number;
  values: number[];
}

/** 期望的响应类型：解码时据此做一致性校验（与 rtu-frame 的 ExpectedResponse 对齐）。 */
export type TcpExpectedResponse = PduExpectedResponse & {
  transactionId: number;
  unitId: number;
};
export type DecodedTcpResponse = DecodedPduResponse;

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
  return buildTcpFrame(
    request.transactionId,
    request.unitId,
    encodeReadPdu(
      FUNCTION_READ_HOLDING,
      request.startAddress,
      request.quantity,
    ),
  );
}

/** 即使只写一个寄存器也使用功能码 0x10（docs/AGENTS.md §5.1）。 */
export function encodeTcpWriteSingleRegisterRequest(
  request: TcpWriteSingleRegisterRequest,
): Uint8Array {
  return buildTcpFrame(
    request.transactionId,
    request.unitId,
    encodeWritePdu(FUNCTION_WRITE_MULTIPLE, request.address, [
      request.rawValue,
    ]),
  );
}

/** FC0x10 多寄存器写入（TCP）：quantity = values.length、byteCount = 2N、值大端。 */
export function encodeTcpWriteMultipleRegistersRequest(
  request: TcpWriteMultipleRegistersRequest,
): Uint8Array {
  return buildTcpFrame(
    request.transactionId,
    request.unitId,
    encodeWritePdu(
      FUNCTION_WRITE_MULTIPLE,
      request.startAddress,
      request.values,
    ),
  );
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

  return decodeResponsePdu(frame.subarray(7), expected, "TCP");
}

/** Encode FC01 or FC02 with an MBAP header. */
export function encodeTcpReadBitsRequest(
  request: TcpReadHoldingRegistersRequest,
  functionCode: number,
): Uint8Array {
  return buildTcpFrame(
    request.transactionId,
    request.unitId,
    encodeReadPdu(functionCode, request.startAddress, request.quantity),
  );
}

/** Encode FC04 with an MBAP header. */
export function encodeTcpReadInputRegistersRequest(
  request: TcpReadHoldingRegistersRequest,
): Uint8Array {
  return buildTcpFrame(
    request.transactionId,
    request.unitId,
    encodeReadPdu(
      FUNCTION_READ_INPUT_REGISTERS,
      request.startAddress,
      request.quantity,
    ),
  );
}

/** Encode FC0F with an MBAP header. Values are ordered coil bits. */
export function encodeTcpWriteMultipleCoilsRequest(
  request: TcpWriteMultipleRegistersRequest,
): Uint8Array {
  return buildTcpFrame(
    request.transactionId,
    request.unitId,
    encodeWritePdu(
      FUNCTION_WRITE_MULTIPLE_COILS,
      request.startAddress,
      request.values,
    ),
  );
}
