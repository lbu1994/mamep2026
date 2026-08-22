/**
 * TCP 帧解析器（docs/TECH_DESIGN.md §8.6）。
 * TCP 是字节流协议：维护接收缓冲，按 MBAP Header 中的 Length 分帧；
 * 处理半包 / 粘包 / 多响应连续到达 / 迟到响应 / 非法 Length。无 CRC（与 RTU 的关键差异）。
 * Transaction ID 由 CommunicationSession 维护（§8.7），本解析器按当前请求的 tid 匹配：
 * 完整帧解码失败（tid / 协议标识 / unitId 不匹配等）时丢弃该帧继续解析——
 * 迟到响应不得被后续请求误接收，当前请求的响应可能出现在其后的帧中。
 */
import { decodeTcpResponse } from "@mamep2026/protocol-modbus";
import type {
  DecodedTcpResponse,
  TcpExpectedResponse,
} from "@mamep2026/protocol-modbus";
import type { Result } from "@mamep2026/domain";

type ParseOutcome =
  | { done: false }
  | { done: true; outcome: Result<DecodedTcpResponse>; frame: Uint8Array };

/** MBAP 头长度：transactionId(2) + protocolId(2) + length(2) + unitId(1)。 */
const MBAP_HEADER_LENGTH = 7;
/**
 * 合法 Length 上限：unitId(1) + 最大 PDU(253) = 254（Modbus TCP 上限）。
 * 超过视为噪声/损坏，丢弃首字节重新同步。
 */
const MAX_MBAP_LENGTH = 254;

export class TcpFrameParser {
  private buffer: number[] = [];
  private readonly expect: TcpExpectedResponse;

  constructor(expect: TcpExpectedResponse) {
    this.expect = expect;
  }

  push(chunk: Uint8Array): ParseOutcome {
    for (const byte of chunk) this.buffer.push(byte);
    return this.tryParse();
  }

  private tryParse(): ParseOutcome {
    while (true) {
      if (this.buffer.length < MBAP_HEADER_LENGTH) return { done: false };
      const declaredLength =
        ((this.buffer[4] ?? 0) << 8) | (this.buffer[5] ?? 0);
      // 非法 Length（0 或超上限）：视为噪声字节，丢弃首字节重新同步（最终由超时兜底）。
      if (declaredLength < 1 || declaredLength > MAX_MBAP_LENGTH) {
        this.buffer.shift();
        continue;
      }
      // 总帧长 = 6（txn/proto/length 字段）+ length 字段值（unitId + PDU）。
      const frameLength = 6 + declaredLength;
      if (this.buffer.length < frameLength) return { done: false };
      const frame = Uint8Array.from(this.buffer.slice(0, frameLength));
      this.buffer = this.buffer.slice(frameLength);
      const result = decodeTcpResponse(frame, this.expect);
      if (result.ok) {
        return { done: true, outcome: result, frame };
      }
      // 完整帧解码失败（迟到响应 tid 不匹配 / 协议标识不匹配 / unitId 不匹配等）：
      // 丢弃该帧继续解析，当前请求的响应可能在其后的帧中。
      continue;
    }
  }
}
