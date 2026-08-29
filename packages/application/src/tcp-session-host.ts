/**
 * TCP 会话宿主（docs/TECH_DESIGN.md §5.1.2 Application 层、docs/AGENTS.md §6）。
 *
 * 协议专用薄封装：构建 protocol="tcp" 的 CommunicationSession（unitId 连接时由
 * profile 确定，连接后可经 setUnitId 动态修改，2026-08-25），其余会话编排
 * （轮询/追踪/批量读取/设备拔出策略）委托共享 SessionHostCore（session-host-core.ts），
 * 与 RtuSessionHost 共用，避免复制核心会话逻辑（AGENTS.md §32 ㉑）。TCP 无 Address Adjust（恒 off）。
 *
 * 本类不感知平台细节：传输由调用方打开后注入（connect 的 transport 参数），
 * 不依赖 platform-api / platform-node。
 */
import type {
  BatchReadHandle,
  BatchReadRow,
  Clock,
  CommunicationLogEvent,
  ConnectionState,
  TransportPort,
  WriteOutcome,
} from "@mamep2026/communication";
import { CommunicationSession } from "@mamep2026/communication";
import type {
  RegisterRow,
  ReadVerifySettings,
  Result,
  TcpConnectionProfile,
} from "@mamep2026/domain";
import { createMamepError, fail } from "@mamep2026/domain";
import type { SessionHostEvents } from "./session-host-core";
import { SessionHostCore } from "./session-host-core";
import { ReconnectCoordinator } from "./reconnect-coordinator";

export type { SessionHostEvents as TcpSessionHostEvents } from "./session-host-core";

/** connect 入参：传输由调用方（NodePlatformHost / fake）打开后注入。 */
export interface TcpConnectInput {
  profile: TcpConnectionProfile;
  transport: TransportPort;
  /** 端口显示标签（UI 通信属性展示用，如 "192.168.1.10:502"）。 */
  portLabel: string | null;
}

export interface TcpSessionHostOptions {
  clock: Clock;
  events: SessionHostEvents;
  /**
   * 自动重连用的传输重开工厂（可选，仅 TCP）：由平台宿主注入（重新 openTcpTransport）。
   * 缺省时 TcpSessionHost 不启用自动重连（profile.autoReconnect 被忽略）。
   */
  openTransport?: (
    profile: TcpConnectionProfile,
  ) => Promise<Result<TransportPort>>;
}

export class TcpSessionHost {
  private readonly core: SessionHostCore;
  private readonly coordinator: ReconnectCoordinator | null;
  private currentProfile: TcpConnectionProfile | null = null;
  private currentPortLabel: string | null = null;

  constructor(options: TcpSessionHostOptions) {
    this.core = new SessionHostCore({
      clock: options.clock,
      events: options.events,
      getPollingIntervalMs: () => this.currentProfile?.interRequestDelayMs ?? 50,
      // TCP 无 Address Adjust（发送地址 = 用户地址，恒 off）。
      getAddressAdjustMode: () => "off",
    });
    // 自动重连仅在注入 openTransport（平台宿主提供重开能力）时启用。
    this.coordinator =
      options.openTransport !== undefined
        ? new ReconnectCoordinator({
            clock: options.clock,
            events: options.events,
            openTransport: options.openTransport,
            performReconnect: (transport) => this.reconnectWith(transport),
          })
        : null;
  }

  /** 打开并连接 TCP 会话：替换旧会话，恢复轮询/追踪配置。 */
  async connect(input: TcpConnectInput): Promise<Result<void>> {
    // 用户主动发起新连接：取消挂起的自动重连。
    this.coordinator?.disarm();
    this.currentProfile = input.profile;
    this.currentPortLabel = input.portLabel;
    const result = await this.core.connect(
      this.buildSession(input.profile, input.transport),
      input.portLabel,
    );
    if (result.ok) {
      // 连接成功：按 profile.autoReconnect 启用自动重连（armed 保持到下次 interrupted）。
      this.coordinator?.arm(input.profile);
    }
    return result;
  }

  /** 自动重连专用：用新传输重建会话（不经 disarm，成功后恢复轮询/追踪并保持 armed）。 */
  private async reconnectWith(transport: TransportPort): Promise<Result<void>> {
    const profile = this.currentProfile;
    if (profile === null) {
      return fail(
        createMamepError({
          code: "CONNECTION_NOT_CONNECTED",
          category: "connection",
          userMessageKey: "errors.notConnected",
          technicalMessage: "reconnect without an active profile",
        }),
      );
    }
    const result = await this.core.connect(
      this.buildSession(profile, transport),
      this.currentPortLabel,
    );
    if (result.ok) {
      // 保持 armed：重连成功后仍开启自动重连（下次 interrupted 再触发）。
      this.coordinator?.arm(profile);
    }
    return result;
  }

  private buildSession(
    profile: TcpConnectionProfile,
    transport: TransportPort,
  ): CommunicationSession {
    return new CommunicationSession({
      transport,
      clock: this.core.clock,
      config: profile,
      protocol: "tcp",
      unitId: profile.unitId,
      onLog: (event: CommunicationLogEvent) => this.core.emitLog(event),
      onStateChange: (state: ConnectionState) => {
        this.core.emitStateChange(state);
        this.coordinator?.onSessionState(state);
      },
    });
  }

  async disconnect(): Promise<Result<void>> {
    // 停止自动重连（docs/AGENTS.md §11.5 第 4 项）。
    this.coordinator?.disarm();
    return this.core.disconnect();
  }

  /** 释放全部资源（Webview 关闭 / 扩展停用 / 卸载）：断开会话并清空状态。 */
  async dispose(): Promise<void> {
    this.coordinator?.disarm();
    await this.core.dispose();
    this.currentProfile = null;
    this.currentPortLabel = null;
  }

  getConnectionState(): ConnectionState {
    return this.coordinator?.getState() ?? this.core.getConnectionState();
  }

  getProfile(): TcpConnectionProfile | null {
    return this.currentProfile;
  }

  getPortLabel(): string | null {
    return this.core.getPortLabel();
  }

  /** 更新当前会话 TCP Unit ID（每表独立，2026-08-25）：对后续所有请求（读/写/轮询/追踪）生效。 */
  setUnitId(unitId: number): void {
    this.core.setUnitId(unitId);
  }

  readRow(row: RegisterRow): Promise<Result<number | number[]>> {
    return this.core.readRow(row);
  }

  writeRow(
    row: RegisterRow,
    options?: { writeVerify?: ReadVerifySettings },
  ): Promise<Result<WriteOutcome>> {
    return this.core.writeRow(row, options);
  }

  readAllRows(rows: BatchReadRow[], batchId?: string): BatchReadHandle {
    return this.core.readAllRows(rows, batchId);
  }

  /** 按 batchId 取消活动批任务（远程路径，ADR-025）：未知/已完成为安全 no-op。 */
  cancelBatch(batchId: string): void {
    this.core.cancelBatch(batchId);
  }

  updatePollingTargets(rows: Array<{ key: string; address: number }>): void {
    this.core.updatePollingTargets(rows);
  }

  startPolling(): void {
    this.core.startPolling();
  }

  stopPolling(): void {
    this.core.stopPolling();
  }

  traceStart(key: string, address: number, speedMs: number, quantity = 1): void {
    this.core.traceStart(key, address, speedMs, quantity);
  }

  traceStop(key: string): void {
    this.core.traceStop(key);
  }
}
