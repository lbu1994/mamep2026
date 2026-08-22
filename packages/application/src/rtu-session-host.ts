/**
 * RTU 会话宿主（docs/TECH_DESIGN.md §5.1.2 Application 层、docs/AGENTS.md §6）。
 *
 * 协议专用薄封装：构建 protocol="rtu" 的 CommunicationSession（含动态从站地址），
 * 其余会话编排（轮询/追踪/批量读取/设备拔出策略）委托共享 SessionHostCore
 * （session-host-core.ts），与 TcpSessionHost 共用，避免复制核心会话逻辑（§32 ㉑）。
 *
 * 本类不感知串口库/平台细节：传输由调用方打开后注入（connect 的 transport 参数），
 * 不依赖 platform-api / platform-node / platform-web。
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
  RtuConnectionProfile,
} from "@mamep2026/domain";
import type { SessionHostEvents } from "./session-host-core";
import { SessionHostCore } from "./session-host-core";

/** 兼容既有命名导出：会话事件接口（定义于 session-host-core）。 */
export type RtuSessionHostEvents = SessionHostEvents;

/** connect 入参：传输由调用方（PlatformHost / NodePlatformHost / fake）打开后注入。 */
export interface RtuConnectInput {
  profile: RtuConnectionProfile;
  transport: TransportPort;
  /** 初始从站地址（连接后可由 setSlaveAddress 动态更新，2026-08-19）。 */
  slaveAddress: number;
  /** 端口显示标签（UI 通信属性展示用；mock 模式由调用方传入 "Mock Device"）。 */
  portLabel: string | null;
}

export interface RtuSessionHostOptions {
  clock: Clock;
  events: RtuSessionHostEvents;
}

export class RtuSessionHost {
  private readonly core: SessionHostCore;
  private currentProfile: RtuConnectionProfile | null = null;

  constructor(options: RtuSessionHostOptions) {
    this.core = new SessionHostCore({
      clock: options.clock,
      events: options.events,
      getPollingIntervalMs: () => this.currentProfile?.interRequestDelayMs ?? 50,
      getAddressAdjustMode: () => this.currentProfile?.addressAdjust ?? "off",
    });
  }

  /** 打开并连接会话：替换旧会话，恢复轮询/追踪配置（与 BrowserAppHost 行为一致）。 */
  async connect(input: RtuConnectInput): Promise<Result<void>> {
    this.currentProfile = input.profile;
    const session = new CommunicationSession({
      transport: input.transport,
      clock: this.core.clock,
      config: input.profile,
      slaveAddress: input.slaveAddress,
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

  getProfile(): RtuConnectionProfile | null {
    return this.currentProfile;
  }

  getPortLabel(): string | null {
    return this.core.getPortLabel();
  }

  /** 更新当前会话从站地址（每表独立）：对后续所有请求（读/写/轮询/追踪）生效。 */
  setSlaveAddress(slave: number): void {
    this.core.setSlaveAddress(slave);
  }

  readRow(row: RegisterRow): Promise<Result<number>> {
    return this.core.readRow(row);
  }

  writeRow(row: RegisterRow): Promise<Result<WriteOutcome>> {
    return this.core.writeRow(row);
  }

  readAllRows(rows: BatchReadRow[]): BatchReadHandle {
    return this.core.readAllRows(rows);
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

