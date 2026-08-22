/**
 * 会话编排核心（docs/TECH_DESIGN.md §5.1.2 Application 层、docs/AGENTS.md §6）。
 *
 * 组合 CommunicationSession + 轮询/追踪/批量读取协调器 + RegisterTableService（地址调整），
 * 统一承载「连接后的 Modbus 会话编排」，**协议无关**：RtuSessionHost 与 TcpSessionHost
 * 共用本类，只负责按协议构建 CommunicationSession（protocol/unitId 已在 session 上设定），
 * 避免为多协议复制核心会话逻辑（AGENTS.md §32 ㉑）。
 *
 * 职责边界：
 * - 打开/关闭会话、单行读/写、全表读取、WP 轮询、TM 追踪；
 * - 设备拔出（interrupted）策略：停止轮询与追踪并上报消息（§16.2.5）；
 * - 所有事件经 events 回调外抛，由宿主分发到本地订阅者或经 HostMessage v1 推送；
 * - 不感知串口库/协议细节：传输与会话由协议专用宿主打开/构建后注入。
 */
import type {
  BatchReadHandle,
  BatchReadRow,
  Clock,
  CommunicationLogEvent,
  CommunicationSession,
  ConnectionState,
  TraceSample,
  WriteOutcome,
} from "@mamep2026/communication";
import {
  BatchReadCoordinator,
  PollingCoordinator,
  TraceCoordinator,
} from "@mamep2026/communication";
import {
  createMamepError,
  fail,
  ok,
  type AddressAdjustMode,
  type RegisterRow,
  type Result,
} from "@mamep2026/domain";
import type { ApplicationMessage } from "@mamep2026/logging";
import { RegisterTableService } from "@mamep2026/register-table";

/** 会话编排对外事件（宿主负责分发到本地订阅者或经 RPC 推送）。 */
export interface SessionHostEvents {
  onLog(event: CommunicationLogEvent): void;
  onStateChange(state: ConnectionState): void;
  onPollResult(key: string, address: number, result: Result<number>): void;
  onTraceSample(sample: TraceSample): void;
  onMessage(message: ApplicationMessage): void;
}

export interface SessionHostCoreOptions {
  clock: Clock;
  events: SessionHostEvents;
  /** WP 轮询间隔源（RTU/TCP 均为 profile.interRequestDelayMs）。 */
  getPollingIntervalMs: () => number;
  /** Address Adjust 模式源（RTU=profile.addressAdjust；TCP 恒 off）。 */
  getAddressAdjustMode: () => AddressAdjustMode;
}

export class SessionHostCore {
  readonly clock: Clock;
  private readonly events: SessionHostEvents;
  private readonly tableService: RegisterTableService;
  private readonly getPollingIntervalMs: () => number;
  private session: CommunicationSession | null = null;
  private polling: PollingCoordinator | null = null;
  private trace: TraceCoordinator | null = null;
  private portLabel: string | null = null;
  private pollingTargets: Array<{ key: string; address: number }> = [];
  private readonly activeTraces = new Map<
    string,
    { address: number; speedMs: number }
  >();

  constructor(options: SessionHostCoreOptions) {
    this.clock = options.clock;
    this.events = options.events;
    this.getPollingIntervalMs = options.getPollingIntervalMs;
    this.tableService = new RegisterTableService({
      getSession: () => this.session,
      getAddressAdjustMode: options.getAddressAdjustMode,
    });
  }

  /** 打开并连接会话：替换旧会话，恢复轮询/追踪配置（与 BrowserAppHost 行为一致）。 */
  async connect(
    session: CommunicationSession,
    portLabel: string | null,
  ): Promise<Result<void>> {
    // 停止旧连接的轮询与追踪。
    this.stopPolling();
    this.trace?.stopAll();
    await this.session?.disconnect();

    this.portLabel = portLabel;

    const result = await session.connect();
    if (!result.ok) {
      // 连接失败：关闭传输，避免底层句柄残留（EBUSY 同类问题）。
      await session.disconnect();
      return result;
    }
    this.session = session;

    // 重建协调器并恢复轮询/追踪配置。
    this.polling = new PollingCoordinator(session, this.clock, {
      getIntervalMs: () => this.getPollingIntervalMs(),
    });
    this.polling.onResult((key, address, result) =>
      this.events.onPollResult(key, address, result),
    );
    this.trace = new TraceCoordinator(session, this.clock);
    this.trace.onSample((sample) => this.events.onTraceSample(sample));

    if (this.pollingTargets.length > 0) {
      this.polling.setTargets(this.pollingTargets);
      this.polling.start();
    }
    for (const [key, entry] of this.activeTraces) {
      this.trace.start(key, entry.address, entry.speedMs);
    }
    return ok(undefined);
  }

  async disconnect(): Promise<Result<void>> {
    this.stopPolling();
    this.trace?.stopAll();
    const result = await this.session?.disconnect();
    this.session = null;
    return result ?? { ok: true, value: undefined };
  }

  /** 释放全部资源（Webview 关闭 / 扩展停用 / 卸载）：断开会话并清空状态。 */
  async dispose(): Promise<void> {
    await this.disconnect();
    this.polling = null;
    this.trace = null;
    this.portLabel = null;
  }

  getConnectionState(): ConnectionState {
    return this.session?.getState() ?? "disconnected";
  }

  getPortLabel(): string | null {
    return this.portLabel;
  }

  /** 更新会话从站地址（RTU，每表独立）：对后续所有请求（读/写/轮询/追踪）生效。 */
  setSlaveAddress(slave: number): void {
    this.session?.setSlaveAddress(slave);
  }

  readRow(row: RegisterRow): Promise<Result<number>> {
    return this.tableService.readRow(row);
  }

  writeRow(row: RegisterRow): Promise<Result<WriteOutcome>> {
    return this.tableService.writeRow(row);
  }

  readAllRows(rows: BatchReadRow[]): BatchReadHandle {
    if (this.session === null) {
      return {
        promise: Promise.resolve(
          fail(
            createMamepError({
              code: "CONNECTION_NOT_CONNECTED",
              category: "connection",
              userMessageKey: "errors.notConnected",
              technicalMessage: "no active connection",
            }),
          ),
        ),
        cancel: () => undefined,
      };
    }
    const coordinator = new BatchReadCoordinator(this.session, this.clock);
    return coordinator.readAll(rows, (key, result) => {
      // 与 BrowserAppHost 既有行为一致：批量读取结果经轮询结果通道上报（address 0）。
      this.events.onPollResult(key, 0, result);
    });
  }

  updatePollingTargets(rows: Array<{ key: string; address: number }>): void {
    this.pollingTargets = rows;
    this.polling?.setTargets(rows);
    if (rows.length > 0 && this.session !== null) {
      this.polling?.start();
    } else {
      this.polling?.stop();
    }
  }

  startPolling(): void {
    if (this.pollingTargets.length > 0 && this.session !== null) {
      this.polling?.start();
    }
  }

  stopPolling(): void {
    this.polling?.stop();
  }

  traceStart(key: string, address: number, speedMs: number): void {
    this.activeTraces.set(key, { address, speedMs });
    this.trace?.start(key, address, speedMs);
  }

  traceStop(key: string): void {
    this.activeTraces.delete(key);
    this.trace?.stop(key);
  }

  /** 会话通信日志转发（协议专用宿主的 CommunicationSession onLog 回调）。 */
  emitLog(event: CommunicationLogEvent): void {
    this.events.onLog(event);
  }

  /** 会话状态变化转发（协议专用宿主的 CommunicationSession onStateChange 回调）。 */
  emitStateChange(state: ConnectionState): void {
    if (state === "interrupted") {
      // 设备拔出：停止轮询与追踪，并提示用户（§16.2.5）。
      this.stopPolling();
      this.trace?.stopAll();
      this.events.onMessage({
        timestamp: this.clock.now(),
        level: "error",
        messageKey: "messages.deviceDisconnected",
        detail: null,
      });
    }
    this.events.onStateChange(state);
  }
}
