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
 * - 所有事件经 events 回调外抛，由宿主分发到本地订阅者或经 HostMessage v2 推送；
 * - 不感知串口库/协议细节：传输与会话由协议专用宿主打开/构建后注入。
 */
import type {
  TraceIdentity,
  BatchReadHandle,
  BatchReadRow,
  Clock,
  CodecRegistry,
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
  type AddressTransform,
  type AddressTransformConfig,
  type PollResultEvent,
  type ReadVerifySettings,
  type RegisterRow,
  type RequestRoute,
  type Result,
} from "@mamep2026/domain";
import type { ApplicationMessage } from "@mamep2026/logging";
import { RegisterTableService } from "@mamep2026/register-table";

/** 会话编排对外事件（宿主负责分发到本地订阅者或经 RPC 推送）。 */
export interface SessionHostEvents {
  onLog(event: CommunicationLogEvent): void;
  onStateChange(state: ConnectionState): void;
  onPollResult(event: PollResultEvent): void;
  onTraceSample(sample: TraceSample): void;
  onMessage(message: ApplicationMessage): void;
}

export interface SessionHostCoreOptions {
  clock: Clock;
  events: SessionHostEvents;
  /** WP 轮询间隔源（删除 Rx Delay 后恒为 0：读完一个立即读下一个）。 */
  getPollingIntervalMs: () => number;
  /**
   * 地址变换解析（插件插件外部化）：按 transformId 返回运行时
   * 变换；缺省不调整（核心不再内置变换，由宿主装配点注入随包插件 resolver）。
   */
  resolveAddressTransform?: (transformId: string) => AddressTransform | null;
  /** codec 注册表： 宿主据此构建 codec 会话；协议无关，仅透传。 */
  codecRegistry?: CodecRegistry;
}

export class SessionHostCore {
  readonly clock: Clock;
  private readonly events: SessionHostEvents;
  private readonly tableService: RegisterTableService;
  private readonly getPollingIntervalMs: () => number;
  private readonly resolveAddressTransform: (
    transformId: string,
  ) => AddressTransform | null;
  /** 活动表地址变换配置：渲染端在表切换/配置变化时同步（host 端经 RPC）。 */
  private addressTransform: AddressTransformConfig | null = null;
  /** codec 注册表：透传，供宿主构建 codec 会话。 */
  private readonly codecRegistry: CodecRegistry | null;
  private session: CommunicationSession | null = null;
  private polling: PollingCoordinator | null = null;
  private trace: TraceCoordinator | null = null;
  private portLabel: string | null = null;
  private pollingTargets: Array<{
    key: string;
    sheetId: string;
    address: number;
    quantity?: number;
    route?: RequestRoute;
  }> = [];
  /** 连接代次：断线/重连前的在途结果不得进入新连接。 */
  private connectionGeneration = 0;
  /** 批量读取请求代次：跨调用单调递增，供结果身份诊断与上层过滤。 */
  private batchRequestGeneration = 0;
  /** 不兼容轮询提示去重：当前协议或跳过协议集合变化时才再次上报。 */
  private skippedProtocolNotice: string | null = null;
  /** 后台挂起标志（移动端生命周期）：挂起期间不启动轮询/追踪，回前台按原配置恢复。 */
  private backgroundSuspended = false;
  private readonly activeTraces = new Map<
    string,
    {
      address: number;
      speedMs: number;
      quantity: number;
      identity?: TraceIdentity;
      route?: RequestRoute;
    }
  >();
  /** 活动批任务登记（远程路径按 batchId 取消）：promise 落定后注销。 */
  private readonly activeBatches = new Map<string, BatchReadHandle>();

  constructor(options: SessionHostCoreOptions) {
    this.clock = options.clock;
    this.events = options.events;
    this.getPollingIntervalMs = options.getPollingIntervalMs;
    // 地址变换解析（插件外部化）：核心不再内置变换；由宿主装配点注入
    // （Renderer 经插件的 AddressTransformRegistry；桌面端 host 经随包插件导出 resolver）。
    this.resolveAddressTransform =
      options.resolveAddressTransform ?? (() => null);
    this.codecRegistry = options.codecRegistry ?? null;
    this.tableService = new RegisterTableService({
      getSession: () => this.session,
      getAddressTransform: () => this.getAddressTransform(),
      clock: options.clock,
    });
  }

  /** 设置活动表地址变换配置：供表级 Address Adjust；null=不调整。 */
  setAddressTransform(config: AddressTransformConfig | null): void {
    this.addressTransform = config;
  }

  /** 解析活动表配置为运行时变换：未启用/未知 id 返回 null（不调整）。 */
  private getAddressTransform(): AddressTransform | null {
    const config = this.addressTransform;
    if (config === null || !config.enabled) return null;
    return this.resolveAddressTransform(config.transformId);
  }

  /** 打开并连接会话：替换旧会话，恢复轮询/追踪配置（与 BrowserAppHost 行为一致）。 */
  async connect(
    session: CommunicationSession,
    portLabel: string | null,
  ): Promise<Result<void>> {
    // 先推进连接代次：旧会话在途请求即使稍后返回，也不得进入新连接的事件流。
    const connectionGeneration = ++this.connectionGeneration;
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
    this.polling.onResult((event) => {
      if (connectionGeneration !== this.connectionGeneration) return;
      this.events.onPollResult({ ...event, connectionGeneration });
    });
    this.trace = new TraceCoordinator(session, this.clock);
    this.trace.onSample((sample) => {
      if (connectionGeneration === this.connectionGeneration)
        this.events.onTraceSample(sample);
    });

    this.syncPollingTargets();
    if (this.pollingTargets.length > 0 && !this.backgroundSuspended) {
      this.polling.start();
    }
    if (!this.backgroundSuspended) {
      for (const [key, entry] of this.activeTraces) {
        if (this.isRouteCompatible(entry.route)) {
          this.trace.start(
            key,
            entry.address,
            entry.speedMs,
            entry.quantity,
            entry.route,
            entry.identity,
          );
        }
      }
    }
    return ok(undefined);
  }

  async disconnect(): Promise<Result<void>> {
    this.connectionGeneration += 1;
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

  /** 当前会话：插件通信面经统一调度器访问；未连接返回 null。 */
  getSession(): CommunicationSession | null {
    return this.session;
  }

  getPortLabel(): string | null {
    return this.portLabel;
  }

  /** codec 注册表： 宿主据此构建 codec 会话；协议无关，仅透传。 */
  getCodecRegistry(): CodecRegistry | null {
    return this.codecRegistry;
  }

  private isRouteCompatible(route: RequestRoute | undefined): boolean {
    return (
      route === undefined ||
      this.session === null ||
      route.protocol === this.session.getProtocol()
    );
  }

  private routeMismatchError(route: RequestRoute | undefined) {
    const requestProtocol = route?.protocol ?? "";
    const sessionProtocol = this.session?.getProtocol() ?? "";
    return createMamepError({
      code: "REQUEST_ROUTE_PROTOCOL_MISMATCH",
      category: "capability",
      severity: "warning",
      retryable: false,
      userMessageKey: "errors.requestRouteProtocolMismatch",
      technicalMessage: `request protocol ${requestProtocol} does not match session protocol ${sessionProtocol}`,
    });
  }

  /**
   * 只把与当前会话协议兼容的轮询目标交给协调器；所有 WP 配置仍保留在
   * pollingTargets 中，供下次兼容连接恢复。提示按协议集合去重。
   */
  private syncPollingTargets() {
    const incompatibleProtocols = new Set<string>();
    const compatible = this.pollingTargets.filter((target) => {
      const ok = this.isRouteCompatible(target.route);
      if (!ok && target.route !== undefined) {
        incompatibleProtocols.add(target.route.protocol);
      }
      return ok;
    });
    this.polling?.setTargets(compatible);

    if (incompatibleProtocols.size === 0 || this.session === null) {
      this.skippedProtocolNotice = null;
      return compatible;
    }
    const protocols = [...incompatibleProtocols].sort();
    const fingerprint = `${this.session.getProtocol()}:${protocols.join(",")}`;
    if (fingerprint !== this.skippedProtocolNotice) {
      this.skippedProtocolNotice = fingerprint;
      this.events.onMessage({
        timestamp: this.clock.now(),
        level: "warning",
        messageKey: "messages.requestRouteProtocolSkipped",
        params: { protocols: protocols.join(", ") },
        detail: null,
      });
    }
    return compatible;
  }

  /** 更新会话从站地址（RTU，每表独立）：对后续所有请求（读/写/轮询/追踪）生效。 */
  setSlaveAddress(slave: number): void {
    this.session?.setSlaveAddress(slave);
  }

  /** 更新会话 TCP Unit ID（协议无关：由协议宿主决定调用 setSlaveAddress / setUnitId）。 */
  setUnitId(unitId: number): void {
    this.session?.setUnitId(unitId);
  }

  readRow(
    row: RegisterRow,
    route?: RequestRoute,
  ): Promise<Result<number | number[]>> {
    return this.tableService.readRow(row, route);
  }

  /**
   * 单行写入（支持写后回读）：
   * - options.writeVerify 非 off 时经 TableService 组合「写入 → 可选延迟 → FC03 回读」；
   * - §18.3：写入（及回读）期间暂缓同一行的普通轮询，完成后恢复；
   *   其他行轮询不受影响；用户已停止轮询时不得自动重新启用（defer/resume 只作用于当前实例）。
   */
  writeRow(
    row: RegisterRow,
    options: { writeVerify?: ReadVerifySettings } = {},
    route?: RequestRoute,
  ): Promise<Result<WriteOutcome>> {
    this.polling?.defer(row.rowId);
    const promise = this.tableService.writeRow(row, options, route);
    void promise.finally(() => this.polling?.resume(row.rowId));
    return promise;
  }

  readAllRows(
    rows: BatchReadRow[],
    batchId?: string,
    route?: RequestRoute,
  ): BatchReadHandle {
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
    if (!this.isRouteCompatible(route)) {
      return {
        promise: Promise.resolve(fail(this.routeMismatchError(route))),
        cancel: () => undefined,
      };
    }
    const coordinator = new BatchReadCoordinator(this.session, this.clock);
    const connectionGeneration = this.connectionGeneration;
    const requestGeneration = ++this.batchRequestGeneration;
    const handle = coordinator.readAll(
      rows,
      (event) => {
        if (connectionGeneration !== this.connectionGeneration) return;
        this.events.onPollResult({ ...event, connectionGeneration });
      },
      batchId,
      route,
      requestGeneration,
    );
    if (batchId !== undefined) {
      // 远程路径：登记活动批任务，promise 落定后注销，供 cancelBatch 关联取消。
      this.activeBatches.set(batchId, handle);
      void handle.promise.then(
        () => this.activeBatches.delete(batchId),
        () => this.activeBatches.delete(batchId),
      );
    }
    return handle;
  }

  /** 按 batchId 取消活动批任务：未知/已完成/未连接均为安全 no-op。 */
  cancelBatch(batchId: string): void {
    this.activeBatches.get(batchId)?.cancel();
  }

  updatePollingTargets(
    rows: Array<{
      key: string;
      sheetId: string;
      address: number;
      quantity?: number;
      route?: RequestRoute;
    }>,
  ): void {
    this.pollingTargets = rows;
    const compatible = this.syncPollingTargets();
    if (
      compatible.length > 0 &&
      this.session !== null &&
      !this.backgroundSuspended
    ) {
      this.polling?.start();
    } else {
      this.polling?.stop();
    }
  }

  startPolling(): void {
    this.syncPollingTargets();
    if (
      this.pollingTargets.some((target) =>
        this.isRouteCompatible(target.route),
      ) &&
      this.session !== null &&
      !this.backgroundSuspended
    ) {
      this.polling?.start();
    }
  }

  stopPolling(): void {
    this.polling?.stop();
  }

  /**
   * 应用进入后台（移动端生命周期）：暂停轮询与追踪。
   *
   * 只暂停"持续占用总线"的后台任务；`pollingTargets` 与 `activeTraces` **保留**，
   * 供回前台时按原配置恢复（与断线重连的恢复路径同源）。幂等：重复调用无副作用。
   */
  pauseBackground(): void {
    this.backgroundSuspended = true;
    this.stopPolling();
    this.trace?.stopAll();
  }

  /**
   * 回到前台：按挂起前的配置恢复轮询与追踪。
   * 幂等；未挂起时无操作；离线（无会话）时不启动（连接建立时会自行恢复）。
   */
  resumeBackground(): void {
    if (!this.backgroundSuspended) return;
    this.backgroundSuspended = false;
    if (this.session === null) return;
    if (this.pollingTargets.length > 0) {
      this.syncPollingTargets();
      this.polling?.start();
    }
    for (const [key, entry] of this.activeTraces) {
      if (this.isRouteCompatible(entry.route)) {
        this.trace?.start(
          key,
          entry.address,
          entry.speedMs,
          entry.quantity,
          entry.route,
          entry.identity,
        );
      }
    }
  }

  isBackgroundSuspended(): boolean {
    return this.backgroundSuspended;
  }

  traceStart(
    key: string,
    address: number,
    speedMs: number,
    quantity = 1,
    route?: RequestRoute,
    identity?: TraceIdentity,
  ): void {
    const resolvedRoute = route ?? this.session?.getCurrentRoute();
    this.activeTraces.set(key, {
      address,
      speedMs,
      quantity,
      ...(resolvedRoute !== undefined ? { route: { ...resolvedRoute } } : {}),
      ...(identity !== undefined ? { identity: { ...identity } } : {}),
    });
    this.trace?.stop(key);
    if (this.backgroundSuspended) return;
    if (!this.isRouteCompatible(resolvedRoute)) {
      this.events.onMessage({
        timestamp: this.clock.now(),
        level: "warning",
        messageKey: "messages.requestRouteProtocolSkipped",
        params: { protocols: resolvedRoute?.protocol ?? "" },
        detail: null,
      });
      return;
    }
    this.trace?.start(key, address, speedMs, quantity, resolvedRoute, identity);
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
