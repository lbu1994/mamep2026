/**
 * 协议编解码器抽象（插件）。
 *
 * 让 CommunicationSession 支持「协议可注入」：内置 "rtu"/"tcp" 之外，可通过 CodecRegistry
 * 注册自定义协议（如安川 MEMOBUS 67/010D、67/010E），会话按 codecId 委托编解码与分帧。
 *
 * 本文件协议无关：不 import protocol-modbus / protocol-memobus（保持分层，AGENTS §8.1）。
 */
import type { MamepError, Result } from "@mamep2026/domain";

/** 读请求：寄存器编号列表（可连续可不连续；是否允许非连续由 codec 决定）。 */
export interface CodecReadRequest {
  /** 单元地址（RTU 类承载 = 从站地址；TCP 类承载可视为 Unit ID）。 */
  slaveAddress: number;
  addresses: number[];
}

/** 写请求中的单个寄存器写入项。 */
export interface CodecWriteEntry {
  address: number;
  value: number;
}

/** 写请求：寄存器编号 + 值列表（可连续可不连续）。 */
export interface CodecWriteRequest {
  slaveAddress: number;
  entries: CodecWriteEntry[];
}

/** codec 解码结果（判别名与协议包区分：read/write vs read-holding/write-multiple）。 */
export type CodecDecodedResponse =
  | { kind: "read"; values: number[] }
  | { kind: "write" }
  | { kind: "exception"; exceptionCode: number };

/** codec 期望描述：会话构造并注入，供 codec 做响应一致性校验（对齐 AGENTS §10.2 语义）。 */
export type CodecExpect =
  | { protocolId: string; kind: "read"; request: CodecReadRequest }
  | { protocolId: string; kind: "write"; request: CodecWriteRequest };

/** 分帧解析器：从字节流切出完整帧（半包/粘包/CRC 重同步由 codec 实现）。 */
export interface FrameParser {
  push(
    chunk: Uint8Array,
  ):
    | { done: false }
    | { done: true; outcome: Result<CodecDecodedResponse>; frame: Uint8Array };
}

/** 协议编解码器。 */
export interface ProtocolCodec {
  /** 协议唯一 ID（如 "yaskawa-memobus"），即会话 protocol 的 codecId。 */
  protocolId: string;
  /** 单次读上限（缺省 125，对齐 FC03 语义）。 */
  maxRead?: number;
  /** 单次写上限（缺省 123，对齐 FC0x10 语义）。 */
  maxWrite?: number;
  encodeRead(req: CodecReadRequest): Uint8Array;
  encodeWrite(req: CodecWriteRequest): Uint8Array;
  decodeResponse(
    frame: Uint8Array,
    expect: CodecExpect,
  ): Result<CodecDecodedResponse>;
  parserFactory(expect: CodecExpect): FrameParser;
  expectedLength(
    kind: "read" | "write",
    expect: CodecExpect,
  ): { normal: number; exception: number };
  /** 异常响应 → MamepError（缺省由会话按通用设备异常映射）。 */
  mapException?(exceptionCode: number): MamepError;
}

/** 通用 codec 注册表（1B）。 */
export interface CodecRegistry {
  register(codec: ProtocolCodec): void;
  get(id: string): ProtocolCodec | undefined;
  list(): string[];
}

export function createCodecRegistry(): CodecRegistry {
  const codecs = new Map<string, ProtocolCodec>();
  return {
    register(codec) {
      codecs.set(codec.protocolId, codec);
    },
    get(id) {
      return codecs.get(id);
    },
    list() {
      return Array.from(codecs.keys());
    },
  };
}
