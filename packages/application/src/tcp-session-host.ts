/**
 * TCP 会话宿主（docs/TECH_DESIGN.md §5.1.2 Application 层、docs/AGENTS.md §6）。
 *
 * 协议专用薄封装：构建 protocol="tcp" 的 CommunicationSession（unitId 连接时由
 * profile 确定，会话内不做动态修改），其余会话编排（轮询/追踪/批量读取/设备拔出策略）
 * 委托共享 SessionHostCore（session-host-core.ts），与 RtuSessionHost 共用，
 * 避免复制核心会话逻辑（AGENTS.md §32 ㉑）。TCP 无 Address Adjust（恒 off）。
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
  Result,
  TcpConnectionProfile,
} from "@mamep2026/domain";
import type { SessionHostEvents } from "./session-host-core";
import { SessionHostCore } from "./session-host-core";

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
}

export class TcpSessionHost {
  private readonly core: SessionHostCore;
  private currentProfile: TcpConnectionProfile | null = null;

  constructor(options: TcpSessionHostOptions) {
    this.core = new SessionHostCore({
      clock: options.clock,
      events: options.events,
      getPollingIntervalMs: () => this.currentProfile?.interRequestDelayMs ?? 50,
      // TCP 无 Address Adjust（发送地址 = 用户地址，恒 off）。
      getAddressAdjustMode: () => "off",
    });
  }

  /** 打开并连接 TCP 会话：替换旧会话，恢复轮询/追踪配置。 */
  async connect(input: TcpConnectInput): Promise<Result<void>> {
    this.currentProfile = input.profile;
    const session = new CommunicationSession({
      transport: input.transport,
      clock: this.core.clock,
      config: input.profile,
      protocol: "tcp",
      unitId: input.profile.unitId,
      onLog: (event: CommunicationLogEvent) => this.core.emitLog(event),
      onStateChange: (state: ConnectionState) => this.core.emitStateChange(state),
    });
    return this.core.connect(session, input.portLabel);
  }

  async disconnect(): Promise<Result<void>> {
    return this.core.disconnect();
  }

  /** 释放全部资源（Webview 关闭 / 扩展停用 / 卸载）：断开会话并清空状态。 */
  async dispose(): Promise<void> {
    await this.core.dispose();
    this.currentProfile = null;
  }

  getConnectionState(): ConnectionState {
    return this.core.getConnectionState();
  }

  getProfile(): TcpConnectionProfile | null {
    return this.currentProfile;
  }

  getPortLabel(): string | null {
    return this.core.getPortLabel();
  }

  readRow(row: RegisterRow): Promise<Result<number>> {
    return this.core.readRow(row);
  }

  writeRow(row: RegisterRow): Promise<Result<WriteOutcome>> {
    return this.core.writeRow(row);
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

  traceStart(key: string, address: number, speedMs: number): void {
    this.core.traceStart(key, address, speedMs);
  }

  traceStop(key: string): void {
    this.core.traceStop(key);
  }
}
