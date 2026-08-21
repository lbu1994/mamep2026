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
} from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import {
  decodeRtuResponse,
  encodeReadHoldingRegistersRequest,
  encodeWriteSingleRegisterRequest,
  FUNCTION_READ_HOLDING,
  FUNCTION_WRITE_MULTIPLE,
  type DecodedRtuResponse,
  type ExpectedResponse,
} from "@mamep2026/protocol-modbus";
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

export type WriteOutcome = { kind: "write-succeeded-no-verify" };

interface ExchangeMeta {
  source: RequestSource;
  userAddress: number | null;
  sentAddress: number | null;
  functionCode: number;
  quantity: number;
}

interface PendingExchange {
  cancelToken: CancellationToken;
  /** 取消当前等待并失败返回（disconnect / 资源释放用）。 */
  cancel: (reason: string) => void;
  /** 写入完成后开始超时计时（超时从完整请求实际发送后开始）。 */
  startTimeout: () => void;
  promise: Promise<Result<{ result: DecodedRtuResponse; frame: Uint8Array }>>;
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
  config: RtuConnectionProfile;
  /** 初始从站地址（默认 1）；连接后可经 setSlaveAddress 动态更新（2026-08-19）。 */
  slaveAddress?: number;
  onLog?: (event: CommunicationLogEvent) => void;
  onStateChange?: (state: ConnectionState) => void;
  fairnessThresholdMs?: number;
}

export class CommunicationSession {
  readonly stateMachine = new ConnectionStateMachine();
  private readonly options: SessionOptions;
  private readonly scheduler: RequestScheduler;
  private pendingExchange: PendingExchange | null = null;
  /** 当前从站地址：连接后可动态更新（每表独立设置，2026-08-19）。 */
  private slaveAddress: number;

  constructor(options: SessionOptions) {
    this.options = options;
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
          protocol: "rtu",
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
      protocol: "rtu",
      slaveAddress: this.slaveAddress,
      functionCode: null,
      userAddress: null,
      sentAddress: null,
      quantity: null,
      attempt: 0,
      status: "failure",
      errorCode: error.code,
      exceptionCode: null,
      source: "connection-control",
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

  /** 动态更新当前从站地址：对后续所有请求（读/写/轮询/追踪）生效（2026-08-19）。 */
  setSlaveAddress(slave: number): void {
    this.slaveAddress = slave;
  }

  getConfig(): RtuConnectionProfile {
    return this.options.config;
  }

  async connect(): Promise<Result<void>> {
    if (this.stateMachine.getState() === "connected") return ok(undefined);
    if (!this.stateMachine.transition("connecting").ok) {
      this.stateMachine.forceState("connecting");
    }
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
    meta: {
      source: RequestSource;
      userAddress?: number;
      priority?: RequestPriority;
      group?: string;
      cancelToken?: CancellationToken;
    },
  ): Promise<Result<number>> {
    if (this.stateMachine.getState() !== "connected") {
      return Promise.resolve(fail(notConnectedError()));
    }
    return this.scheduler
      .enqueue(() => this.executeRead(sentAddress, meta), {
        priority: meta.priority ?? "manual-read",
        group: meta.group,
        cancelToken: meta.cancelToken,
      })
      .then((result) => result);
  }

  writeRegister(
    sentAddress: number,
    rawValue: number,
    meta: { source: RequestSource; userAddress?: number },
  ): Promise<Result<WriteOutcome>> {
    if (this.stateMachine.getState() !== "connected") {
      return Promise.resolve(fail(notConnectedError()));
    }
    return this.scheduler.enqueue(
      () => this.executeWrite(sentAddress, rawValue, meta),
      { priority: "manual-write" },
    );
  }

  private async executeRead(
    sentAddress: number,
    meta: { source: RequestSource; userAddress?: number },
  ): Promise<Result<number>> {
    const expect: ExpectedResponse = {
      kind: "read-holding",
      slaveAddress: this.slaveAddress,
      startAddress: sentAddress,
      quantity: 1,
    };
    const decoded = await this.executeExchange(
      () =>
        encodeReadHoldingRegistersRequest({
          slaveAddress: this.slaveAddress,
          startAddress: sentAddress,
          quantity: 1,
        }),
      expect,
      {
        source: meta.source,
        userAddress: meta.userAddress ?? null,
        sentAddress,
        functionCode: FUNCTION_READ_HOLDING,
        quantity: 1,
      },
    );
    if (!decoded.ok) return decoded;
    if (decoded.value.kind === "exception") {
      return fail(modbusExceptionError(decoded.value.exceptionCode));
    }
    if (decoded.value.kind === "read-holding") {
      return ok(decoded.value.values[0] ?? 0);
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
    rawValue: number,
    meta: { source: RequestSource; userAddress?: number },
  ): Promise<Result<WriteOutcome>> {
    const expect: ExpectedResponse = {
      kind: "write-single",
      slaveAddress: this.slaveAddress,
      address: sentAddress,
      quantity: 1,
    };
    const decoded = await this.executeExchange(
      () =>
        encodeWriteSingleRegisterRequest({
          slaveAddress: this.slaveAddress,
          address: sentAddress,
          rawValue,
        }),
      expect,
      {
        source: meta.source,
        userAddress: meta.userAddress ?? null,
        sentAddress,
        functionCode: FUNCTION_WRITE_MULTIPLE,
        quantity: 1,
      },
    );
    if (!decoded.ok) return decoded;
    // 写入异常响应（功能码 0x10|0x80）：转失败，与 executeRead 一致；异常不重试（§13.2）。
    if (decoded.value.kind === "exception") {
      return fail(modbusExceptionError(decoded.value.exceptionCode));
    }
    if (decoded.value.kind === "write-single") {
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

  private async executeExchange(
    buildRequest: () => Uint8Array,
    expect: ExpectedResponse,
    meta: ExchangeMeta,
  ): Promise<Result<DecodedRtuResponse>> {
    const maxAttempts = this.options.config.retryCount + 1;
    let lastResult: Result<DecodedRtuResponse> | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.stateMachine.getState() !== "connected") {
        return fail(notConnectedError());
      }

      const frame = buildRequest();
      const startedAt = this.options.clock.now();
      this.emitLog({
        timestamp: startedAt,
        direction: "request",
        bytes: frame,
        protocol: "rtu",
        slaveAddress: expect.slaveAddress,
        functionCode: meta.functionCode,
        userAddress: meta.userAddress,
        sentAddress: meta.sentAddress,
        quantity: meta.quantity,
        attempt,
        status: "success",
        errorCode: null,
        exceptionCode: null,
        source: meta.source,
        durationMs: null,
      });

      // 先注册数据监听，再写字节，避免设备响应在监听建立前到达而丢失。
      const exchange = this.startExchange(expect);
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
        const decoded = single.value.result;
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

  private startExchange(expect: ExpectedResponse): PendingExchange {
    const parser = new RtuFrameParser(expect);
    const cancelToken = createCancellationToken();
    let settled = false;
    let timeoutHandle: { cancel(): void } | null = null;
    let unsubscribeData: (() => void) | null = null;
    let resolvePromise: (
      result: Result<{ result: DecodedRtuResponse; frame: Uint8Array }>,
    ) => void = () => {};

    const finish = (
      result: Result<{ result: DecodedRtuResponse; frame: Uint8Array }>,
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
      Result<{ result: DecodedRtuResponse; frame: Uint8Array }>
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
      protocol: "rtu",
      slaveAddress: this.slaveAddress,
      functionCode: meta.functionCode,
      userAddress: meta.userAddress,
      sentAddress: meta.sentAddress,
      quantity: meta.quantity,
      attempt,
      status,
      errorCode,
      exceptionCode,
      source: meta.source,
      durationMs: this.options.clock.now() - startedAt,
    });
  }

  private emitLog(event: CommunicationLogEvent): void {
    this.options.onLog?.(event);
  }
}
