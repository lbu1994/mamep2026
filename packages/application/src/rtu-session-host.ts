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
  CodecRegistry,
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
  RtuConnectionProfile,
  AddressTransform,
  AddressTransformConfig,
  RequestRoute,
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
  /** 会话协议（ADR-041 决策 A）：缺省 rtu；安川表 = "yaskawa-memobus-67h-010dh-010eh"（codec 会话）。 */
  protocol?: string;
  /** codec 注册表（protocol 为 codecId 时必填，ADR-041）：会话按 codecId 解析 codec。 */
  codecRegistry?: CodecRegistry;
}

export interface RtuSessionHostOptions {
  clock: Clock;
  events: RtuSessionHostEvents;
  /** 地址变换解析（ADR-042）：缺省仅内置 builtin.address-adjust。 */
  resolveAddressTransform?: (transformId: string) => AddressTransform | null;
}

export class RtuSessionHost {
  private readonly core: SessionHostCore;
  private currentProfile: RtuConnectionProfile | null = null;

  constructor(options: RtuSessionHostOptions) {
    this.core = new SessionHostCore({
      clock: options.clock,
      events: options.events,
      getPollingIntervalMs: () => 0,
      ...(options.resolveAddressTransform !== undefined
        ? { resolveAddressTransform: options.resolveAddressTransform }
        : {}),
    });
  }

  /** 打开并连接会话：替换旧会话，恢复轮询/追踪配置（与 BrowserAppHost 行为一致）。 */
  async connect(input: RtuConnectInput): Promise<Result<void>> {
    this.currentProfile = input.profile;
    const session = new CommunicationSession({
      transport: input.transport,
      clock: this.core.clock,
      config: input.profile,
      // 协议路由（ADR-041 决策 A）：缺省 rtu；codecId 时注入 codec 注册表（内置安川插件 activate 已填充）。
      ...(input.protocol !== undefined ? { protocol: input.protocol } : {}),
      ...(input.codecRegistry !== undefined
        ? { codecRegistry: input.codecRegistry }
        : {}),
      slaveAddress: input.slaveAddress,
      onLog: (event: CommunicationLogEvent) => this.core.emitLog(event),
      onStateChange: (state: ConnectionState) =>
        this.core.emitStateChange(state),
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

  /** 当前会话（ADR-044 Phase F-2）：插件通信面用；未连接返回 null。 */
  getSession(): CommunicationSession | null {
    return this.core.getSession();
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

  /** 更新活动表地址变换配置（ADR-042）：对后续读/写请求生效（轮询地址在 Renderer 生成）。 */
  setAddressTransform(config: AddressTransformConfig | null): void {
    this.core.setAddressTransform(config);
  }

  readRow(
    row: RegisterRow,
    route?: RequestRoute,
  ): Promise<Result<number | number[]>> {
    return this.core.readRow(row, route);
  }

  writeRow(
    row: RegisterRow,
    options?: { writeVerify?: ReadVerifySettings },
    route?: RequestRoute,
  ): Promise<Result<WriteOutcome>> {
    return this.core.writeRow(row, options, route);
  }

  readAllRows(
    rows: BatchReadRow[],
    batchId?: string,
    route?: RequestRoute,
  ): BatchReadHandle {
    return this.core.readAllRows(rows, batchId, route);
  }

  /** 按 batchId 取消活动批任务（远程路径，ADR-025）：未知/已完成为安全 no-op。 */
  cancelBatch(batchId: string): void {
    this.core.cancelBatch(batchId);
  }

  updatePollingTargets(
    rows: Array<{
      key: string;
      address: number;
      quantity?: number;
      route?: RequestRoute;
    }>,
  ): void {
    this.core.updatePollingTargets(rows);
  }

  startPolling(): void {
    this.core.startPolling();
  }

  stopPolling(): void {
    this.core.stopPolling();
  }

  /** 应用进入后台（ADR-050 Phase 3）：暂停轮询/追踪，保留配置供回前台恢复。 */
  pauseBackground(): void {
    this.core.pauseBackground();
  }

  /** 应用回到前台：按挂起前配置恢复轮询/追踪；幂等。 */
  resumeBackground(): void {
    this.core.resumeBackground();
  }

  isBackgroundSuspended(): boolean {
    return this.core.isBackgroundSuspended();
  }

  traceStart(
    key: string,
    address: number,
    speedMs: number,
    quantity = 1,
    route?: RequestRoute,
  ): void {
    this.core.traceStart(key, address, speedMs, quantity, route);
  }

  traceStop(key: string): void {
    this.core.traceStop(key);
  }
}
