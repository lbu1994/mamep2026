/**
 * VSCode Extension Host 侧 RTU 会话宿主（docs/TECH_DESIGN.md §5.1.2、§6.3、§22.2）。
 *
 * 组合 NodePlatformHost（串口枚举/打开，packages/platform-node）+ RtuSessionHost
 * （会话/调度/轮询/追踪编排，packages/application）。通信在 Extension Host 执行
 * （TECH_DESIGN §28.3），Renderer 经 HostMessage v1 RPC 访问本类。
 *
 * 会话事件（通信日志/连接状态/轮询结果/追踪样本/应用消息）经 events 回调外抛，
 * 由装配方（extension.ts）转换为 HostMessage v1 event 推送 Webview。
 * 本类为领域导向（输入输出为 domain/communication 对象），payload 转换由 ipc.ts 承担。
 */
import {
  RtuSessionHost,
  TcpSessionHost,
  type RtuSessionHostEvents,
} from "@mamep2026/application";
import type {
  BatchReadHandle,
  BatchReadRow,
  CodecRegistry,
  ConnectionState,
  WriteOutcome,
} from "@mamep2026/communication";
import { NodePlatformHost } from "@mamep2026/platform-node";
import type { SerialPortOption } from "@mamep2026/platform-api";
import type {
  RegisterRow,
  ReadVerifySettings,
  Result,
  RtuConnectionProfile,
  TcpConnectionProfile,
  AddressTransform,
  RequestRoute,
} from "@mamep2026/domain";
import { ok } from "@mamep2026/domain";

export interface VscodeSessionHostOptions {
  platform: NodePlatformHost;
  /** 会话事件（由装配方转换为 HostMessage v1 event 推送 Webview）。 */
  events: RtuSessionHostEvents;
  /** codec 注册表（ADR-043 E-6；ADR-055 起由宿主侧插件运行时提供）：插件/基础表 codec 会话经它解析。 */
  codecRegistry?: CodecRegistry;
  /**
   * 地址变换解析（2026-09-02 插件外部化；2026-09-12 ADR-055）：由宿主侧插件运行时
   * （HostPluginRuntime）注入，随插件安装/启停自动更新。
   */
  resolveAddressTransform?: (transformId: string) => AddressTransform | null;
}

export class VscodeSessionHost {
  private readonly platform: NodePlatformHost;
  private readonly rtu: RtuSessionHost;
  private readonly tcp: TcpSessionHost;
  /** codec 注册表（ADR-043 E-6）：基础表/安川 codec 会话解析用；null=未注入（缺省仅 rtu）。 */
  private readonly codecRegistry: CodecRegistry | null;
  /** 当前活动协议会话（由最近一次 connect/connectTcp 决定）。 */
  private active: "rtu" | "tcp" | null = null;

  constructor(options: VscodeSessionHostOptions) {
    this.platform = options.platform;
    this.codecRegistry = options.codecRegistry ?? null;
    this.rtu = new RtuSessionHost({
      clock: options.platform.clock,
      events: options.events,
      ...(options.codecRegistry !== undefined
        ? { codecRegistry: options.codecRegistry }
        : {}),
      ...(options.resolveAddressTransform !== undefined
        ? { resolveAddressTransform: options.resolveAddressTransform }
        : {}),
    });
    this.tcp = new TcpSessionHost({
      clock: options.platform.clock,
      events: options.events,
      // 自动重连（2026-08-30）：重连时由协调器重新打开 TCP 传输。
      openTransport: (profile) => this.platform.openTcpTransport(profile),
      ...(options.resolveAddressTransform !== undefined
        ? { resolveAddressTransform: options.resolveAddressTransform }
        : {}),
    });
  }

  /** 活动会话宿主；未连接时回退 RTU 宿主（其核心对无会话返回 not-connected）。 */
  private get activeSession(): RtuSessionHost | TcpSessionHost {
    if (this.active === "tcp") return this.tcp;
    return this.rtu;
  }

  /** 枚举系统串口（VSCode 无浏览器授权手势约束，直接返回列表）。 */
  async enumerateSerialPorts(): Promise<Result<SerialPortOption[]>> {
    const result = await this.platform.enumerateSerialPorts();
    if (!result.ok) return result;
    return ok(
      result.value.map((handle) => ({
        portId: handle.id,
        label: handle.label,
      })),
    );
  }

  /** 打开并连接 RTU 会话（portId 为 enumerateSerialPorts 返回的端口）。
   *  ADR-043 E-6：protocol 为 codecId 时走 codec 会话（基础表/安川），缺省 rtu。 */
  async connect(
    portId: string,
    profile: RtuConnectionProfile,
    slaveAddress: number,
    options?: { protocol?: string },
  ): Promise<Result<void>> {
    const openResult = await this.platform.openSerialTransport(
      { id: portId, label: portId },
      profile,
    );
    if (!openResult.ok) return openResult;
    const result = await this.rtu.connect({
      profile,
      transport: openResult.value,
      slaveAddress,
      portLabel: portId,
      ...(options?.protocol !== undefined && options.protocol !== "rtu"
        ? { protocol: options.protocol }
        : {}),
      ...(options?.protocol !== undefined &&
      options.protocol !== "rtu" &&
      this.codecRegistry !== null
        ? { codecRegistry: this.codecRegistry }
        : {}),
    });
    if (result.ok) this.active = "rtu";
    return result;
  }

  /** 打开并连接 TCP 会话（session-tcp-connect；profile 即连接参数，无串口句柄）。 */
  async connectTcp(profile: TcpConnectionProfile): Promise<Result<void>> {
    const openResult = await this.platform.openTcpTransport(profile);
    if (!openResult.ok) return openResult;
    const result = await this.tcp.connect({
      profile,
      transport: openResult.value,
      portLabel: `${profile.host}:${profile.port}`,
    });
    if (result.ok) this.active = "tcp";
    return result;
  }

  disconnect(): Promise<Result<void>> {
    return this.activeSession.disconnect();
  }

  getConnectionState(): ConnectionState {
    return this.activeSession.getConnectionState();
  }

  /** RTU 从站地址（每表独立）：仅 RTU 活动时生效（渲染端按协议路由，2026-08-25）。 */
  setSlaveAddress(slave: number): void {
    if (this.active === "rtu") this.rtu.setSlaveAddress(slave);
  }

  /** TCP Unit ID 会话内动态修改（2026-08-25）：仅 TCP 活动时生效，对后续请求生效。 */
  setUnitId(unitId: number): void {
    if (this.active === "tcp") this.tcp.setUnitId(unitId);
  }

  /** 表级 Address Adjust（ADR-042）：仅 RTU 活动时生效（TCP 无地址变换），同步到宿主会话。 */
  setAddressTransform(
    config: {
      transformId: string;
      enabled: boolean;
    } | null,
  ): void {
    if (this.active === "rtu") this.rtu.setAddressTransform(config);
  }

  readRow(
    row: RegisterRow,
    route?: RequestRoute,
  ): Promise<Result<number | number[]>> {
    return this.activeSession.readRow(row, route);
  }

  writeRow(
    row: RegisterRow,
    options?: { writeVerify?: ReadVerifySettings },
    route?: RequestRoute,
  ): Promise<Result<WriteOutcome>> {
    return this.activeSession.writeRow(row, options, route);
  }

  /** 全表读取：行结果经 poll-result 事件流上报（address 0），返回 BatchReadHandle。 */
  readAllRows(
    rows: BatchReadRow[],
    batchId?: string,
    route?: RequestRoute,
  ): BatchReadHandle {
    return this.activeSession.readAllRows(rows, batchId, route);
  }

  /** 按 batchId 取消活动批任务（远程路径，ADR-025）：未知/已完成为安全 no-op。 */
  cancelBatch(batchId: string): void {
    this.activeSession.cancelBatch(batchId);
  }

  updatePollingTargets(
    rows: Array<{
      key: string;
      address: number;
      quantity?: number;
      route?: RequestRoute;
    }>,
  ): void {
    this.activeSession.updatePollingTargets(rows);
  }

  startPolling(): void {
    this.activeSession.startPolling();
  }

  stopPolling(): void {
    this.activeSession.stopPolling();
  }

  traceStart(
    key: string,
    address: number,
    speedMs: number,
    quantity = 1,
    route?: RequestRoute,
  ): void {
    this.activeSession.traceStart(key, address, speedMs, quantity, route);
  }

  traceStop(key: string): void {
    this.activeSession.traceStop(key);
  }

  /** 释放全部资源（Webview 关闭 / 扩展停用）。 */
  async dispose(): Promise<void> {
    await this.rtu.dispose();
    await this.tcp.dispose();
    this.active = null;
  }
}
