/**
 * 通信会话（docs/TECH_DESIGN.md §6.7、docs/AGENTS.md §10~§13）。
 * - 单连接单队列：所有请求经 RequestScheduler 串行执行；
 * - 超时从完整请求发送后开始；重试按 retryCount 语义（额外尝试次数）；
 * - RTU 响应按期望长度分帧；迟到响应被丢弃并记录；
 * - interRequestDelayMs（Rx Delay）作为相邻请求最小间隔，兼作轮询间隔。
 */
import {
  createMamepError,
  type MamepError,
  type Result,
  type RtuConnectionProfile,
  type TcpConnectionProfile,
} from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import {
  decodeRtuResponse,
  encodeReadHoldingRegistersRequest,
  encodeTcpReadHoldingRegistersRequest,
  encodeTcpWriteMultipleRegistersRequest,
  encodeWriteMultipleRegistersRequest,
  FUNCTION_READ_HOLDING,
  FUNCTION_WRITE_MULTIPLE,
  MAX_READ_QUANTITY,
  MAX_WRITE_QUANTITY,
  type DecodedRtuResponse,
  type DecodedTcpResponse,
  type ExpectedResponse,
  type TcpExpectedResponse,
} from "@mamep2026/protocol-modbus";
import type {
  CodecDecodedResponse,
  CodecExpect,
  CodecReadRequest,
  CodecRegistry,
  CodecWriteEntry,
  CodecWriteRequest,
  FrameParser,
  ProtocolCodec,
} from "./codec";
import { TcpFrameParser } from "./tcp-frame-parser";
import {
  createCancellationToken,
  type CancellationToken,
} from "./cancellation";
import type { Clock } from "./clock";
import {
  ConnectionStateMachine,
  type ConnectionState,
} from "./connection-state-machine";
import type { CommunicationLogEvent, RequestSource } from "./log-event";
import { RequestScheduler, type RequestPriority } from "./request-scheduler";
import type { TransportPort } from "./transport-port";

/**
 * 写入结果（docs/TECH_DESIGN.md §15.3、docs/AGENTS.md §18.2）。
 * 写后回读（2026-08-26）：写入与回读为相关但独立的两阶段；
 * 回读失败不得把已成功的写入显示为写入失败（verify-failed 仍属写入成功）。
 * 多寄存器（ADR-030，2026-08-27）：verify 结果携带 readValues/expectedValues 数组
 * （单寄存器写入为长度 1 的数组）。
 */
export type WriteOutcome =
  | { kind: "write-succeeded-no-verify" }
  | { kind: "write-succeeded-verify-matched"; readValues: number[] }
  | {
      kind: "write-succeeded-verify-mismatched";
      expectedValues: number[];
      readValues: number[];
    }
  | {
      kind: "write-succeeded-verify-failed";
      errorCode: string;
      userMessageKey: string;
    }
  | { kind: "cancelled-before-verify" };

/** 读请求元数据（多寄存器 quantity 由 readRegisters 单独传入，ADR-030）。 */
export interface ReadRegistersMeta {
  source: RequestSource;
  userAddress?: number;
  priority?: RequestPriority;
  group?: string;
  cancelToken?: CancellationToken;
  /** 发起插件 id（source="plugin" 时必填，流入通信日志；ADR-039）。 */
  pluginId?: string | null;
}

/** 写请求元数据（多寄存器 values 由 writeRegisters 传入，ADR-030）。 */
export interface WriteRegistersMeta {
  source: RequestSource;
  userAddress?: number;
  /** 插件写请求可指定 plugin-background（ADR-039）；缺省保持 manual-write。 */
  priority?: RequestPriority;
  /** 发起插件 id（source="plugin" 时必填，流入通信日志；ADR-039）。 */
  pluginId?: string | null;
}

interface ExchangeMeta {
  source: RequestSource;
  userAddress: number | null;
  sentAddress: number | null;
  /** 功能码（codec 路径由 codec 自定义，日志记录为 null；ADR-040）。 */
  functionCode: number | null;
  quantity: number;
  pluginId: string | null;
}

/** 会话协议：rtu（默认）/ tcp（2026-08-23 TCP 接线）。 */
export type SessionProtocol = "rtu" | "tcp";

/** 内置 RTU 与 TCP 解码结果的公共形态（kind 判别兼容）。 */
type DecodedResponse = DecodedRtuResponse | DecodedTcpResponse;

/** 全部解码结果（内置 + codec，ADR-040）：判别名互斥，可安全判别。 */
type AnyDecodedResponse = DecodedResponse | CodecDecodedResponse;

/** 会话内部统一的分帧解析器形态：内置 Rtu/TcpFrameParser 与 codec FrameParser 均可赋值。 */
interface SessionFrameParser {
  push(
    chunk: Uint8Array,
  ):
    | { done: false }
    | { done: true; outcome: Result<AnyDecodedResponse>; frame: Uint8Array };
}

/** 单次交换尝试：内置路径（内置 expect，无 parser）或 codec 路径（CodecExpect + codec parser）。 */
type SessionAttempt =
  | {
      frame: Uint8Array;
      expect: ExpectedResponse | TcpExpectedResponse;
      parser?: undefined;
    }
  | { frame: Uint8Array; expect: CodecExpect; parser: FrameParser };

/** 内置路径分帧解析器：RTU 期望响应含 slaveAddress；TCP 含 transactionId/unitId（无歧义判别）。 */
function builtinParserFor(
  expect: ExpectedResponse | TcpExpectedResponse,
): SessionFrameParser {
  return "slaveAddress" in expect
    ? new RtuFrameParser(expect)
    : new TcpFrameParser(expect);
}

interface PendingExchange {
  cancelToken: CancellationToken;
  /** 取消当前等待并失败返回（disconnect / 资源释放用）。 */
  cancel: (reason: string) => void;
  /** 写入完成后开始超时计时（超时从完整请求实际发送后开始）。 */
  startTimeout: () => void;
  promise: Promise<Result<{ result: AnyDecodedResponse; frame: Uint8Array }>>;
}

function cancelledError(reason: string): MamepError {
  return createMamepError({
    code: "CANCELLED",
    category: "cancellation",
    severity: "info",
    retryable: false,
    userMessageKey: "errors.cancelled",
    technicalMessage: reason,
  });
}

function notConnectedError(): MamepError {
  return createMamepError({
    code: "CONNECTION_NOT_CONNECTED",
    category: "connection",
    severity: "warning",
    retryable: false,
    userMessageKey: "errors.notConnected",
    technicalMessage: "session is not connected",
  });
}

/** 未知 codecId（ADR-040）：构造期报错，不静默回退。 */
function codecNotFoundError(codecId: string): MamepError {
  return createMamepError({
    code: "CODEC_NOT_FOUND",
    category: "capability",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.internal",
    technicalMessage: `codec not found for protocol: ${codecId}`,
  });
}

/** 非连续读写需要 codec 协议（内置 rtu/tcp 不支持，ADR-040）。 */
function codecRequiredError(): MamepError {
  return createMamepError({
    code: "CODEC_REQUIRED",
    category: "capability",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.internal",
    technicalMessage: "codec protocol required for this operation",
  });
}

function timeoutError(timeoutMs: number): MamepError {
  return createMamepError({
    code: "REQUEST_TIMEOUT",
    category: "timeout",
    severity: "error",
    retryable: true,
    userMessageKey: "errors.requestTimeout",
    technicalMessage: `no response within ${timeoutMs}ms`,
  });
}

/** quantity 越界守卫（ADR-030）：读 ≤125、写 ≤123，由会话层统一校验。 */
function quantityOutOfRangeError(
  operation: "read" | "write",
  quantity: number,
): MamepError {
  return createMamepError({
    code: "QUANTITY_OUT_OF_RANGE",
    category: "validation",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.internal",
    technicalMessage: `invalid ${operation} quantity: ${quantity}`,
  });
}

function modbusExceptionError(exceptionCode: number): MamepError {
  return createMamepError({
    code: `MODBUS_EXCEPTION_${exceptionCode.toString(16).toUpperCase().padStart(2, "0")}`,
    category: "modbus-exception",
    severity: "warning",
    retryable: false,
    userMessageKey: "errors.modbusException",
    technicalMessage: `modbus exception code ${exceptionCode}`,
  });
}

function unexpectedResponseKindError(
  operation: string,
  decoded: unknown,
): MamepError {
  return createMamepError({
    code: "UNEXPECTED_RESPONSE_KIND",
    category: "protocol",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.unexpectedResponse",
    technicalMessage: `unexpected response kind for ${operation}: ${String(decoded)}`,
  });
}

/** 连续地址列表（codec 路径把 sentAddress+quantity 映射为地址列表，ADR-040）。 */
function contiguousAddresses(start: number, quantity: number): number[] {
  return Array.from(
    { length: quantity },
    (_, index) => (start + index) & 0xffff,
  );
}

type ParseOutcome =
  | { done: false }
  | { done: true; outcome: Result<DecodedRtuResponse>; frame: Uint8Array };

/** RTU 帧解析器：按期望长度分帧，从噪声中同步，CRC 失败丢弃首字节继续。 */
class RtuFrameParser {
  private buffer: number[] = [];
  private readonly expect: ExpectedResponse;

  constructor(expect: ExpectedResponse) {
    this.expect = expect;
  }

  push(chunk: Uint8Array): ParseOutcome {
    for (const byte of chunk) this.buffer.push(byte);
    return this.tryParse();
  }

  private tryParse(): ParseOutcome {
    while (true) {
      const slaveIdx = this.buffer.indexOf(this.expect.slaveAddress);
      if (slaveIdx === -1) {
        this.buffer = [];
        return { done: false };
      }
      if (slaveIdx > 0) {
        this.buffer = this.buffer.slice(slaveIdx);
      }
      if (this.buffer.length < 2) return { done: false };

      const expectedFunction =
        this.expect.kind === "read-holding"
          ? FUNCTION_READ_HOLDING
          : FUNCTION_WRITE_MULTIPLE;
      const functionByte = this.buffer[1] ?? -1;

      let frameLength: number;
      if (functionByte === expectedFunction) {
        frameLength =
          this.expect.kind === "read-holding"
            ? 3 + this.expect.quantity * 2 + 2
            : 8;
      } else if (functionByte === (expectedFunction | 0x80)) {
        frameLength = 5;
      } else {
        // 噪声字节：丢弃后重新同步。
        this.buffer.shift();
        continue;
      }

      if (this.buffer.length < frameLength) return { done: false };
      const frame = Uint8Array.from(this.buffer.slice(0, frameLength));
      const result = decodeRtuResponse(frame, this.expect);
      if (result.ok) {
        this.buffer = this.buffer.slice(frameLength);
        return { done: true, outcome: result, frame };
      }
      if (result.error.code === "RTU_CRC_MISMATCH") {
        // CRC 损坏：丢弃首字节继续尝试同步，最终由超时兜底。
        this.buffer.shift();
        continue;
      }
      this.buffer = this.buffer.slice(frameLength);
      return { done: true, outcome: result, frame };
    }
  }
}

export interface SessionOptions {
  transport: TransportPort;
  clock: Clock;
  /** 连接配置快照；超时、重试、Rx Delay 的修改对后续请求生效。 */
  config: RtuConnectionProfile | TcpConnectionProfile;
  /** 协议：rtu（默认）/ tcp / 注册表 codecId（ADR-040 插件 Phase B）。 */
  protocol?: SessionProtocol | string;
  /** codec 注册表：protocol 为 codecId 时用于解析 codec（ADR-040）。 */
  codecRegistry?: CodecRegistry;
  /** 初始从站地址（RTU，默认 1）；连接后可经 setSlaveAddress 动态更新（2026-08-19）。 */
  slaveAddress?: number;
  /** TCP Unit ID（MBAP 单元标识，默认 0）：连接时由 profile 确定，连接后可经 setUnitId 动态更新（2026-08-25）。 */
  unitId?: number;
  onLog?: (event: CommunicationLogEvent) => void;
  onStateChange?: (state: ConnectionState) => void;
  fairnessThresholdMs?: number;
}

export class CommunicationSession {
  readonly stateMachine = new ConnectionStateMachine();
  private readonly options: SessionOptions;
  private readonly scheduler: RequestScheduler;
  private pendingExchange: PendingExchange | null = null;
  /** 会话协议：rtu / tcp / codecId（ADR-040）。 */
  private readonly protocol: string;
  /** 自定义协议 codec（protocol 为 codecId 时非空；内置 rtu/tcp 为 null，走内置路径）。 */
  private readonly codec: ProtocolCodec | null;
  /** TCP Unit ID（MBAP 单元标识，默认 0）：连接后可经 setUnitId 动态更新（2026-08-25）。 */
  private unitId: number;
  /** 当前从站地址（RTU）：连接后可动态更新（每表独立设置，2026-08-19）。 */
  private slaveAddress: number;
  /** TCP Transaction ID 计数器：16 位递增回绕，连接时重置（§8.7）。 */
  private nextTransactionId = 0;

  constructor(options: SessionOptions) {
    this.options = options;
    this.protocol = options.protocol ?? "rtu";
    // ADR-040 决策 2（1B 通用注册表）：内置 rtu/tcp 走既有内置路径（双轨零回归）；
    // codecId 从注册表解析，未知即构造期报错（不静默回退）。
    if (this.protocol !== "rtu" && this.protocol !== "tcp") {
      const codec = options.codecRegistry?.get(this.protocol);
      if (!codec) {
        throw codecNotFoundError(this.protocol);
      }
      this.codec = codec;
    } else {
      this.codec = null;
    }
    this.unitId = options.unitId ?? 0;
    this.slaveAddress = options.slaveAddress ?? 1;
    this.scheduler = new RequestScheduler(options.clock, {
      fairnessThresholdMs: options.fairnessThresholdMs ?? 2000,
      getInterRequestDelayMs: () => this.options.config.interRequestDelayMs,
    });
    this.stateMachine.subscribe((state) => this.options.onStateChange?.(state));
    options.transport.onData((chunk) => {
      if (this.pendingExchange === null) {
        // 迟到响应：丢弃并记录。
        this.emitLog({
          timestamp: this.options.clock.now(),
          direction: "response",
          bytes: chunk,
          protocol: this.protocol,
          slaveAddress: null,
          functionCode: null,
          userAddress: null,
          sentAddress: null,
          quantity: null,
          attempt: 0,
          status: "discarded",
          errorCode: "LATE_RESPONSE_DISCARDED",
          exceptionCode: null,
          source: "connection-control",
          pluginId: null,
          durationMs: null,
        });
      }
    });
    // 设备拔出 / 传输错误：外部事件（docs/AGENTS.md §11.4），转为 interrupted/failed。
    options.transport.onClose(() => this.handleTransportClosed());
    options.transport.onError((error) => this.handleTransportError(error));
  }

  private handleTransportClosed(): void {
    const state = this.stateMachine.getState();
    if (state === "connected") {
      this.pendingExchange?.cancel("transport-closed");
      this.pendingExchange = null;
      this.enterInterrupted();
    } else if (state === "connecting") {
      this.enterFailed();
    }
    // 正常 disconnect 路径：状态已是 disconnecting，忽略避免误转 interrupted。
  }

  private handleTransportError(error: MamepError): void {
    const state = this.stateMachine.getState();
    if (state === "connected") {
      this.pendingExchange?.cancel("transport-error");
      this.pendingExchange = null;
      this.enterInterrupted();
    } else if (state === "connecting") {
      this.enterFailed();
    }
    this.emitLog({
      timestamp: this.options.clock.now(),
      direction: "response",
      bytes: new Uint8Array(0),
      protocol: this.protocol,
      slaveAddress: this.logUnitAddress(),
      functionCode: null,
      userAddress: null,
      sentAddress: null,
      quantity: null,
      attempt: 0,
      status: "failure",
      errorCode: error.code,
      exceptionCode: null,
      source: "connection-control",
      pluginId: null,
      durationMs: null,
    });
  }

  private enterInterrupted(): void {
    if (!this.stateMachine.transition("interrupted").ok) {
      this.stateMachine.forceState("interrupted");
    }
  }

  private enterFailed(): void {
    if (!this.stateMachine.transition("failed").ok) {
      this.stateMachine.forceState("failed");
    }
  }

  getState(): ConnectionState {
    return this.stateMachine.getState();
  }

  /**
   * 动态更新当前从站地址（RTU）：对后续所有请求（读/写/轮询/追踪）生效（2026-08-19）。
   * TCP 的 Unit ID 由 setUnitId 更新（2026-08-25），两者互不影响。
   */
  setSlaveAddress(slave: number): void {
    this.slaveAddress = slave;
  }

  /**
   * 动态更新当前 TCP Unit ID（MBAP 单元标识）：对后续所有请求（读/写/轮询/追踪）生效
   * （2026-08-25，打通 ADR-022 已知限制）。RTU 从站地址由 setSlaveAddress 更新，两者互不影响。
   */
  setUnitId(unitId: number): void {
    this.unitId = unitId;
  }

  getConfig(): RtuConnectionProfile | TcpConnectionProfile {
    return this.options.config;
  }

  async connect(): Promise<Result<void>> {
    if (this.stateMachine.getState() === "connected") return ok(undefined);
    if (!this.stateMachine.transition("connecting").ok) {
      this.stateMachine.forceState("connecting");
    }
    // TCP Transaction ID 连接重建后重置/重新初始化（§8.7）。
    this.nextTransactionId = 0;
    const openResult = await this.options.transport.open();
    if (!openResult.ok) {
      if (!this.stateMachine.transition("failed").ok)
        this.stateMachine.forceState("failed");
      return openResult;
    }
    if (!this.stateMachine.transition("connected").ok) {
      this.stateMachine.forceState("connected");
    }
    return ok(undefined);
  }

  async disconnect(): Promise<Result<void>> {
    if (this.stateMachine.getState() === "disconnected") return ok(undefined);
    if (!this.stateMachine.transition("disconnecting").ok) {
      this.stateMachine.forceState("disconnecting");
    }

    // 资源释放顺序（docs/AGENTS.md §11.5）：取消排队任务 -> 结束当前等待 -> 关闭传输。
    this.scheduler.cancelAll();
    if (this.pendingExchange !== null) {
      this.pendingExchange.cancel("disconnected");
      this.pendingExchange = null;
    }

    const closeResult = await this.options.transport.close();
    this.stateMachine.forceState("disconnected");
    return closeResult;
  }

  readRegister(
    sentAddress: number,
    meta: ReadRegistersMeta,
  ): Promise<Result<number>> {
    return this.readRegisters(sentAddress, 1, meta).then((result) =>
      result.ok ? ok(result.value[0] ?? 0) : result,
    );
  }

  /** 多寄存器读取（ADR-030）：一次 FC03 读 quantity 个连续寄存器。codec 路径映射为连续地址列表。 */
  readRegisters(
    sentAddress: number,
    quantity: number,
    meta: ReadRegistersMeta,
  ): Promise<Result<number[]>> {
    if (this.stateMachine.getState() !== "connected") {
      return Promise.resolve(fail(notConnectedError()));
    }
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_READ_QUANTITY
    ) {
      return Promise.resolve(
        fail(quantityOutOfRangeError("read", quantity)),
      );
    }
    const run =
      this.codec !== null
        ? () =>
            this.executeCodecRead(
              contiguousAddresses(sentAddress, quantity),
              meta,
            )
        : () => this.executeRead(sentAddress, quantity, meta);
    return this.scheduler
      .enqueue(run, {
        priority: meta.priority ?? "manual-read",
        group: meta.group,
        cancelToken: meta.cancelToken,
      })
      .then((result) => result);
  }

  /**
   * codec 路径：按寄存器编号列表非连续读取（ADR-040）。内置 rtu/tcp 不支持，返回能力错误。
   * 一次请求可读任意不连续寄存器（如安川 MEMOBUS 67/010D，≤120）。
   */
  readRegistersAt(
    addresses: number[],
    meta: ReadRegistersMeta,
  ): Promise<Result<number[]>> {
    if (this.codec === null) {
      return Promise.resolve(fail(codecRequiredError()));
    }
    if (this.stateMachine.getState() !== "connected") {
      return Promise.resolve(fail(notConnectedError()));
    }
    const maxRead = this.codec.maxRead ?? MAX_READ_QUANTITY;
    if (addresses.length < 1 || addresses.length > maxRead) {
      return Promise.resolve(
        fail(quantityOutOfRangeError("read", addresses.length)),
      );
    }
    return this.scheduler
      .enqueue(() => this.executeCodecRead(addresses, meta), {
        priority: meta.priority ?? "manual-read",
        group: meta.group,
        cancelToken: meta.cancelToken,
      })
      .then((result) => result);
  }

  writeRegister(
    sentAddress: number,
    rawValue: number,
    meta: WriteRegistersMeta,
  ): Promise<Result<WriteOutcome>> {
    return this.writeRegisters(sentAddress, [rawValue], meta);
  }

  /** 多寄存器写入（ADR-030）：一次 FC0x10 写 values.length 个连续寄存器。codec 路径映射为连续条目。 */
  writeRegisters(
    sentAddress: number,
    values: number[],
    meta: WriteRegistersMeta,
  ): Promise<Result<WriteOutcome>> {
    if (this.stateMachine.getState() !== "connected") {
      return Promise.resolve(fail(notConnectedError()));
    }
    if (values.length < 1 || values.length > MAX_WRITE_QUANTITY) {
      return Promise.resolve(
        fail(quantityOutOfRangeError("write", values.length)),
      );
    }
    const run =
      this.codec !== null
        ? () =>
            this.executeCodecWrite(
              values.map((value, index) => ({
                address: (sentAddress + index) & 0xffff,
                value,
              })),
              meta,
            )
        : () => this.executeWrite(sentAddress, values, meta);
    return this.scheduler.enqueue(run, {
      priority: meta.priority ?? "manual-write",
    });
  }

  /**
   * codec 路径：按（地址, 值）列表非连续写入（ADR-040）。内置 rtu/tcp 不支持，返回能力错误。
   * 一次请求可写任意不连续寄存器（如安川 MEMOBUS 67/010E，≤60）。
   */
  writeRegistersAt(
    entries: CodecWriteEntry[],
    meta: WriteRegistersMeta,
  ): Promise<Result<WriteOutcome>> {
    if (this.codec === null) {
      return Promise.resolve(fail(codecRequiredError()));
    }
    if (this.stateMachine.getState() !== "connected") {
      return Promise.resolve(fail(notConnectedError()));
    }
    const maxWrite = this.codec.maxWrite ?? MAX_WRITE_QUANTITY;
    if (entries.length < 1 || entries.length > maxWrite) {
      return Promise.resolve(
        fail(quantityOutOfRangeError("write", entries.length)),
      );
    }
    return this.scheduler.enqueue(
      () => this.executeCodecWrite(entries, meta),
      { priority: meta.priority ?? "manual-write" },
    );
  }

  private async executeRead(
    sentAddress: number,
    quantity: number,
    meta: ReadRegistersMeta,
  ): Promise<Result<number[]>> {
    const decoded = await this.executeExchange<DecodedResponse>(
      () => this.buildReadAttempt(sentAddress, quantity),
      {
        source: meta.source,
        userAddress: meta.userAddress ?? null,
        sentAddress,
        functionCode: FUNCTION_READ_HOLDING,
        quantity,
        pluginId: meta.pluginId ?? null,
      },
    );
    if (!decoded.ok) return decoded;
    if (decoded.value.kind === "exception") {
      return fail(modbusExceptionError(decoded.value.exceptionCode));
    }
    if (decoded.value.kind === "read-holding") {
      return ok(decoded.value.values);
    }
    return fail(
      createMamepError({
        code: "UNEXPECTED_RESPONSE_KIND",
        category: "protocol",
        severity: "error",
        retryable: false,
        userMessageKey: "errors.unexpectedResponse",
        technicalMessage: `unexpected response kind for read: ${String(decoded.value)}`,
      }),
    );
  }

  private async executeWrite(
    sentAddress: number,
    values: number[],
    meta: WriteRegistersMeta,
  ): Promise<Result<WriteOutcome>> {
    const decoded = await this.executeExchange<DecodedResponse>(
      () => this.buildWriteAttempt(sentAddress, values),
      {
        source: meta.source,
        userAddress: meta.userAddress ?? null,
        sentAddress,
        functionCode: FUNCTION_WRITE_MULTIPLE,
        quantity: values.length,
        pluginId: meta.pluginId ?? null,
      },
    );
    if (!decoded.ok) return decoded;
    // 写入异常响应（功能码 0x10|0x80）：转失败，与 executeRead 一致；异常不重试（§13.2）。
    if (decoded.value.kind === "exception") {
      return fail(modbusExceptionError(decoded.value.exceptionCode));
    }
    if (decoded.value.kind === "write-multiple") {
      return ok({ kind: "write-succeeded-no-verify" });
    }
    return fail(
      createMamepError({
        code: "UNEXPECTED_RESPONSE_KIND",
        category: "protocol",
        severity: "error",
        retryable: false,
        userMessageKey: "errors.unexpectedResponse",
        technicalMessage: `unexpected response kind for write: ${String(decoded.value)}`,
      }),
    );
  }

  /** codec 路径读执行（ADR-040）：编解码与分帧全委托 codec。 */
  private async executeCodecRead(
    addresses: number[],
    meta: ReadRegistersMeta,
  ): Promise<Result<number[]>> {
    const codec = this.codec;
    if (codec === null) return fail(codecRequiredError());
    const decoded = await this.executeExchange<CodecDecodedResponse>(
      () => this.buildCodecReadAttempt(codec, addresses),
      {
        source: meta.source,
        userAddress: meta.userAddress ?? null,
        sentAddress: addresses[0] ?? null,
        functionCode: null,
        quantity: addresses.length,
        pluginId: meta.pluginId ?? null,
      },
    );
    if (!decoded.ok) return decoded;
    if (decoded.value.kind === "exception") {
      return fail(this.mapCodecException(codec, decoded.value.exceptionCode));
    }
    if (decoded.value.kind === "read") {
      return ok(decoded.value.values);
    }
    return fail(unexpectedResponseKindError("codec read", decoded.value));
  }

  /** codec 路径写执行（ADR-040）：编解码与分帧全委托 codec。 */
  private async executeCodecWrite(
    entries: CodecWriteEntry[],
    meta: WriteRegistersMeta,
  ): Promise<Result<WriteOutcome>> {
    const codec = this.codec;
    if (codec === null) return fail(codecRequiredError());
    const decoded = await this.executeExchange<CodecDecodedResponse>(
      () => this.buildCodecWriteAttempt(codec, entries),
      {
        source: meta.source,
        userAddress: meta.userAddress ?? null,
        sentAddress: entries[0]?.address ?? null,
        functionCode: null,
        quantity: entries.length,
        pluginId: meta.pluginId ?? null,
      },
    );
    if (!decoded.ok) return decoded;
    if (decoded.value.kind === "exception") {
      return fail(this.mapCodecException(codec, decoded.value.exceptionCode));
    }
    if (decoded.value.kind === "write") {
      return ok({ kind: "write-succeeded-no-verify" });
    }
    return fail(unexpectedResponseKindError("codec write", decoded.value));
  }

  /** 构建 codec 读尝试（frame + expect + parser）。 */
  private buildCodecReadAttempt(
    codec: ProtocolCodec,
    addresses: number[],
  ): {
    frame: Uint8Array;
    expect: CodecExpect;
    parser: FrameParser;
  } {
    const request: CodecReadRequest = {
      slaveAddress: this.slaveAddress,
      addresses,
    };
    const expect: CodecExpect = {
      protocolId: codec.protocolId,
      kind: "read",
      request,
    };
    return {
      frame: codec.encodeRead(request),
      expect,
      parser: codec.parserFactory(expect),
    };
  }

  /** 构建 codec 写尝试（frame + expect + parser）。 */
  private buildCodecWriteAttempt(
    codec: ProtocolCodec,
    entries: CodecWriteEntry[],
  ): {
    frame: Uint8Array;
    expect: CodecExpect;
    parser: FrameParser;
  } {
    const request: CodecWriteRequest = {
      slaveAddress: this.slaveAddress,
      entries,
    };
    const expect: CodecExpect = {
      protocolId: codec.protocolId,
      kind: "write",
      request,
    };
    return {
      frame: codec.encodeWrite(request),
      expect,
      parser: codec.parserFactory(expect),
    };
  }

  /** 异常响应 → MamepError：优先 codec 自定义映射，缺省走通用设备异常。 */
  private mapCodecException(
    codec: ProtocolCodec,
    exceptionCode: number,
  ): MamepError {
    return (
      codec.mapException?.(exceptionCode) ??
      modbusExceptionError(exceptionCode)
    );
  }

  private async executeExchange<TDecoded extends AnyDecodedResponse>(
    buildAttempt: () => SessionAttempt,
    meta: ExchangeMeta,
  ): Promise<Result<TDecoded>> {
    const maxAttempts = this.options.config.retryCount + 1;
    let lastResult: Result<TDecoded> | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.stateMachine.getState() !== "connected") {
        return fail(notConnectedError());
      }

      const attemptBundle = buildAttempt();
      const { frame } = attemptBundle;
      const startedAt = this.options.clock.now();
      this.emitLog({
        timestamp: startedAt,
        direction: "request",
        bytes: frame,
        protocol: this.protocol,
        slaveAddress: this.logUnitAddress(),
        functionCode: meta.functionCode,
        userAddress: meta.userAddress,
        sentAddress: meta.sentAddress,
        quantity: meta.quantity,
        attempt,
        status: "success",
        errorCode: null,
        exceptionCode: null,
        source: meta.source,
        pluginId: meta.pluginId,
        durationMs: null,
      });

      // 先注册数据监听，再写字节，避免设备响应在监听建立前到达而丢失。
      const parser: SessionFrameParser =
        attemptBundle.parser !== undefined
          ? attemptBundle.parser
          : builtinParserFor(attemptBundle.expect);
      const exchange = this.startExchange(parser);
      const writeResult = await this.options.transport.write(frame);
      if (!writeResult.ok) {
        exchange.cancel("write-failed");
        lastResult = fail(writeResult.error);
        this.emitExchangeLog(
          new Uint8Array(0),
          attempt,
          startedAt,
          meta,
          "failure",
          writeResult.error.code,
          null,
        );
        continue;
      }
      // 超时从完整请求实际发送后开始（§13.1）。
      exchange.startTimeout();

      const single = await exchange.promise;
      if (single.ok) {
        const decoded = single.value.result as TDecoded;
        if (decoded.kind === "exception") {
          this.emitExchangeLog(
            single.value.frame,
            attempt,
            startedAt,
            meta,
            "failure",
            `MODBUS_EXCEPTION_${decoded.exceptionCode.toString(16).toUpperCase().padStart(2, "0")}`,
            decoded.exceptionCode,
          );
          return ok(decoded);
        }
        this.emitExchangeLog(
          single.value.frame,
          attempt,
          startedAt,
          meta,
          "success",
          null,
          null,
        );
        return ok(decoded);
      }

      this.emitExchangeLog(
        new Uint8Array(0),
        attempt,
        startedAt,
        meta,
        single.error.category === "timeout" ? "timeout" : "failure",
        single.error.code,
        null,
      );
      lastResult = fail(single.error);

      if (!this.shouldRetry(single.error)) {
        return single;
      }
    }

    return lastResult ?? fail(notConnectedError());
  }

  private shouldRetry(error: MamepError): boolean {
    if (!error.retryable) return false;
    // 仅超时与临时传输错误可重试；Modbus 异常与协议不匹配不重试（§13.2）。
    return error.category === "timeout" || error.category === "transport";
  }

  /** 构建单次读尝试（frame + expect）：TCP 每次尝试（含重试）使用新 Transaction ID（§12.2）。 */
  private buildReadAttempt(
    sentAddress: number,
    quantity: number,
  ): {
    frame: Uint8Array;
    expect: ExpectedResponse | TcpExpectedResponse;
  } {
    if (this.protocol === "tcp") {
      const transactionId = this.allocateTransactionId();
      return {
        frame: encodeTcpReadHoldingRegistersRequest({
          transactionId,
          unitId: this.unitId,
          startAddress: sentAddress,
          quantity,
        }),
        expect: {
          kind: "read-holding",
          transactionId,
          unitId: this.unitId,
          startAddress: sentAddress,
          quantity,
        },
      };
    }
    return {
      frame: encodeReadHoldingRegistersRequest({
        slaveAddress: this.slaveAddress,
        startAddress: sentAddress,
        quantity,
      }),
      expect: {
        kind: "read-holding",
        slaveAddress: this.slaveAddress,
        startAddress: sentAddress,
        quantity,
      },
    };
  }

  /** 构建单次写尝试（frame + expect，FC0x10 多值，ADR-030）：TCP 每次尝试使用新 Transaction ID。 */
  private buildWriteAttempt(sentAddress: number, values: number[]): {
    frame: Uint8Array;
    expect: ExpectedResponse | TcpExpectedResponse;
  } {
    if (this.protocol === "tcp") {
      const transactionId = this.allocateTransactionId();
      return {
        frame: encodeTcpWriteMultipleRegistersRequest({
          transactionId,
          unitId: this.unitId,
          startAddress: sentAddress,
          values,
        }),
        expect: {
          kind: "write-multiple",
          transactionId,
          unitId: this.unitId,
          address: sentAddress,
          quantity: values.length,
        },
      };
    }
    return {
      frame: encodeWriteMultipleRegistersRequest({
        slaveAddress: this.slaveAddress,
        startAddress: sentAddress,
        values,
      }),
      expect: {
        kind: "write-multiple",
        slaveAddress: this.slaveAddress,
        address: sentAddress,
        quantity: values.length,
      },
    };
  }

  /** TCP Transaction ID：16 位递增回绕（§8.7）；RTU 无事务 ID（不使用，返回 0）。 */
  private allocateTransactionId(): number {
    const tid = this.nextTransactionId;
    this.nextTransactionId = (this.nextTransactionId + 1) & 0xffff;
    return tid;
  }

  /** 日志字段 slaveAddressOrUnitId：RTU 为当前从站地址，TCP 为 Unit ID。 */
  private logUnitAddress(): number {
    return this.protocol === "tcp" ? this.unitId : this.slaveAddress;
  }

  private startExchange(parser: SessionFrameParser): PendingExchange {
    const cancelToken = createCancellationToken();
    let settled = false;
    let timeoutHandle: { cancel(): void } | null = null;
    let unsubscribeData: (() => void) | null = null;
    let resolvePromise: (
      result: Result<{ result: AnyDecodedResponse; frame: Uint8Array }>,
    ) => void = () => {};

    const finish = (
      result: Result<{ result: AnyDecodedResponse; frame: Uint8Array }>,
    ): void => {
      if (settled) return;
      settled = true;
      timeoutHandle?.cancel();
      unsubscribeData?.();
      if (this.pendingExchange?.cancelToken === cancelToken) {
        this.pendingExchange = null;
      }
      resolvePromise(result);
    };

    const promise = new Promise<
      Result<{ result: AnyDecodedResponse; frame: Uint8Array }>
    >((resolve) => {
      resolvePromise = resolve;
    });

    unsubscribeData = this.options.transport.onData((chunk) => {
      const parsed = parser.push(chunk);
      if (!parsed.done) return;
      if (parsed.outcome.ok) {
        finish(ok({ result: parsed.outcome.value, frame: parsed.frame }));
      } else {
        finish(parsed.outcome);
      }
    });

    const exchange: PendingExchange = {
      cancelToken,
      cancel: (reason) => finish(fail(cancelledError(reason))),
      startTimeout: () => {
        timeoutHandle = this.options.clock.schedule(
          () =>
            finish(fail(timeoutError(this.options.config.requestTimeoutMs))),
          this.options.config.requestTimeoutMs,
        );
      },
      promise,
    };
    this.pendingExchange = exchange;
    return exchange;
  }

  private emitExchangeLog(
    bytes: Uint8Array,
    attempt: number,
    startedAt: number,
    meta: ExchangeMeta,
    status: "success" | "failure" | "timeout",
    errorCode: string | null,
    exceptionCode: number | null,
  ): void {
    this.emitLog({
      timestamp: this.options.clock.now(),
      direction: "response",
      bytes,
      protocol: this.protocol,
      slaveAddress: this.logUnitAddress(),
      functionCode: meta.functionCode,
      userAddress: meta.userAddress,
      sentAddress: meta.sentAddress,
      quantity: meta.quantity,
      attempt,
      status,
      errorCode,
      exceptionCode,
      source: meta.source,
      pluginId: meta.pluginId,
      durationMs: this.options.clock.now() - startedAt,
    });
  }

  private emitLog(event: CommunicationLogEvent): void {
    this.options.onLog?.(event);
  }
}
