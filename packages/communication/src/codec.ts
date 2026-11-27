/**
 * 协议编解码器抽象（插件）。
 *
 * 让 CommunicationSession 支持「协议可注入」：内置 "rtu"/"tcp" 之外，可通过 CodecRegistry
 * 注册自定义协议（如安川 MEMOBUS 67/010D、67/010E），会话按 codecId 委托编解码与分帧。
 *
 * 本文件协议无关：不 import protocol-modbus / protocol-memobus（保持分层，AGENTS §8.1）。
 */
import {
  createMamepError,
  fail,
  ok,
  type MamepError,
  type Result,
} from "@mamep2026/domain";

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

/** One plugin activation owns this scope. Disposal permanently rejects registration. */
export interface CodecRegistrationScope {
  register(codec: ProtocolCodec): Result<void>;
  list(): string[];
  dispose(): void;
}

/** A session retains this registration; replacement never revives an old lease. */
export interface CodecLease {
  readonly codec: ProtocolCodec;
  isCurrent(): boolean;
}

/** Core registrations and plugin activation scopes share one lookup surface. */
export interface CodecRegistry {
  /** Register a core codec. Plugin scopes cannot replace it. */
  register(codec: ProtocolCodec): void;
  get(id: string): ProtocolCodec | undefined;
  list(): string[];
  /** Capture the current registration, including its identity. */
  capture(id: string): CodecLease | undefined;
  /** Create a fresh generation owned by pluginId; disposal only removes its entries. */
  createScope(pluginId: string): CodecRegistrationScope;
}

export function createCodecRegistry(): CodecRegistry {
  const codecs = new Map<
    string,
    { codec: ProtocolCodec; owner: object | null }
  >();
  const list = () => Array.from(codecs.keys());
  return {
    register(codec) {
      codecs.set(codec.protocolId, { codec, owner: null });
    },
    get(id) {
      return codecs.get(id)?.codec;
    },
    list,
    capture(id) {
      const entry = codecs.get(id);
      return entry === undefined
        ? undefined
        : {
            codec: entry.codec,
            isCurrent: () => codecs.get(id) === entry,
          };
    },
    createScope(pluginId) {
      const owner = { pluginId };
      let disposed = false;
      return {
        register(codec) {
          const current = codecs.get(codec.protocolId);
          if (
            disposed ||
            codec.protocolId === "rtu" ||
            codec.protocolId === "tcp" ||
            (current !== undefined && current.owner !== owner)
          ) {
            return fail(
              createMamepError({
                code: disposed ? "CODEC_SCOPE_REVOKED" : "CODEC_ID_CONFLICT",
                category: "plugin",
                retryable: false,
                userMessageKey: "errors.pluginRuntimeNotAvailable",
                technicalMessage: disposed
                  ? `codec scope revoked for plugin ${pluginId}`
                  : `codec ${codec.protocolId} is owned by core or another plugin generation`,
              }),
            );
          }
          codecs.set(codec.protocolId, { codec, owner });
          return ok(undefined);
        },
        list: () => (disposed ? [] : list()),
        dispose() {
          disposed = true;
          for (const [id, entry] of codecs) {
            if (entry.owner === owner) codecs.delete(id);
          }
        },
      };
    },
  };
}
