/**
 * Electron 主进程侧 TCP 会话宿主（docs/TECH_DESIGN.md §5.1.2、§6.2、§28.3）。
 * 组合 NodeTcpPlatformHost（仅 TCP 打开，packages/platform-node/tcp）+ TcpSessionHost
 * （会话/调度/轮询/追踪编排，packages/application）。Electron 的 Modbus TCP 会话
 * 承载在主进程（§6.2 main 职责、§28.3 通信在主进程执行），Renderer 经 HostMessage v2
 * RPC 远程代理；RTU 仍在 Renderer（Web Serial），不经过本类。
 *
 * 注意：平台宿主用「仅 TCP」的 NodeTcpPlatformHost（`@mamep2026/platform-node/tcp`）
 * 而非 NodePlatformHost——后者会静态引入 serialport 原生绑定，被打进主进程 ESM bundle
 * 会在初始化时抛 `__dirname is not defined`。
 * 会话事件经 events 回调外抛，由 main.ts 转换为 HostMessage v2 event 推送 Renderer。
 */
import { TcpSessionHost, type SessionHostEvents } from "@mamep2026/application";
import type {
  BatchReadHandle,
  BatchReadRow,
  ConnectionState,
  WriteOutcome,
} from "@mamep2026/communication";
import { NodeTcpPlatformHost } from "@mamep2026/platform-node/tcp";
import type {
  ReadVerifySettings,
  RegisterRow,
  Result,
  TcpConnectionProfile,
  AddressTransform,
  RequestRoute,
} from "@mamep2026/domain";

export interface ElectronSessionHostOptions {
  platform: NodeTcpPlatformHost;
  /** 会话事件（由 main.ts 转换为 HostMessage v2 event 推送 Renderer）。 */
  events: SessionHostEvents;
  /**
   * 地址变换解析（插件外部化）：由宿主侧插件运行时
   * （HostPluginRuntime，随 application 装配）注入，渲染端不再传递变换函数。
   */
  resolveAddressTransform?: (transformId: string) => AddressTransform | null;
}

export class ElectronSessionHost {
  private readonly platform: NodeTcpPlatformHost;
  private readonly tcp: TcpSessionHost;

  constructor(options: ElectronSessionHostOptions) {
    this.platform = options.platform;
    this.tcp = new TcpSessionHost({
      clock: options.platform.clock,
      events: options.events,
      // 自动重连：重连时由协调器重新打开 TCP 传输。
      openTransport: (profile) => this.platform.openTcpTransport(profile),
      ...(options.resolveAddressTransform !== undefined
        ? { resolveAddressTransform: options.resolveAddressTransform }
        : {}),
    });
  }

  /** 打开并连接 TCP 会话（session-tcp-connect；profile 即连接参数，无串口句柄）。 */
  async connectTcp(profile: TcpConnectionProfile): Promise<Result<void>> {
    const openResult = await this.platform.openTcpTransport(profile);
    if (!openResult.ok) return openResult;
    return this.tcp.connect({
      profile,
      transport: openResult.value,
      portLabel: `${profile.host}:${profile.port}`,
    });
  }

  disconnect(): Promise<Result<void>> {
    return this.tcp.disconnect();
  }

  /** TCP Unit ID 会话内动态修改：对后续所有请求生效。 */
  setUnitId(unitId: number): void {
    this.tcp.setUnitId(unitId);
  }

  getConnectionState(): ConnectionState {
    return this.tcp.getConnectionState();
  }

  readRow(
    row: RegisterRow,
    route?: RequestRoute,
  ): Promise<Result<number | number[]>> {
    return this.tcp.readRow(row, route);
  }

  writeRow(
    row: RegisterRow,
    options?: { writeVerify?: ReadVerifySettings },
    route?: RequestRoute,
  ): Promise<Result<WriteOutcome>> {
    return this.tcp.writeRow(row, options, route);
  }

  readAllRows(
    rows: BatchReadRow[],
    batchId?: string,
    route?: RequestRoute,
  ): BatchReadHandle {
    return this.tcp.readAllRows(rows, batchId, route);
  }

  /** 按 batchId 取消活动批任务（远程路径）：未知/已完成为安全 no-op。 */
  cancelBatch(batchId: string): void {
    this.tcp.cancelBatch(batchId);
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
    this.tcp.updatePollingTargets(rows);
  }

  startPolling(): void {
    this.tcp.startPolling();
  }

  stopPolling(): void {
    this.tcp.stopPolling();
  }

  traceStart(
    key: string,
    address: number,
    speedMs: number,
    quantity = 1,
    route?: RequestRoute,
  ): void {
    this.tcp.traceStart(key, address, speedMs, quantity, route);
  }

  traceStop(key: string): void {
    this.tcp.traceStop(key);
  }

  /** 释放全部资源（窗口关闭 / 应用退出）：断开会话并清空状态。 */
  async dispose(): Promise<void> {
    await this.tcp.dispose();
  }
}
