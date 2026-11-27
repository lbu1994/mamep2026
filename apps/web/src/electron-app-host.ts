import { pluginPermissionDenied } from "@mamep2026/plugin-api";
/**
 * Electron Renderer Host（docs/TECH_DESIGN.md §5.1.6、§6.2）。
 * 实现共享 UI 的 AppHost 契约。串口使用下拉框选择：
 * 仍经 Web Serial API（Renderer navigator.serial），但主进程 select-serial-port 不再自动选
 * 第一个端口，而是把端口列表经 serial-ports-available 事件转发给本 Host，UI 以 antd Select
 * 下拉框展示；用户选择后经 preload 桥 selectSerialPort(portId) 回传主进程解析挂起请求，
 * 再 await requestPort() 得到所选端口对象。连接/读写/轮询/Trace/日志/工作区全部委托复用
 * BrowserAppHost；工作区持久化为主进程文件仓储薄桥
 * FileWorkspaceRepository（应用数据目录版本化 JSON，经 workspace-load/save/clear IPC），
 * 自动保存（AutoSaveCoordinator debounce）与会话恢复语义不变；剪贴板走 preload 白名单桥
 * （window.mamepHost）主进程真实实现。
 */
import type {
  TraceIdentity,
  BatchReadHandle,
  BatchReadRow,
  CodecRegistry,
  CommunicationLogEvent,
  CommunicationSession,
  ConnectionState,
  WriteOutcome,
} from "@mamep2026/communication";
import { createMamepError, defaultConfig, fail, ok } from "@mamep2026/domain";
import type {
  BrowserCompatibility,
  PlatformCapabilities,
  PollResultEvent,
  ReadVerifySettings,
  RegisterRow,
  RequestRoute,
  Result,
  RtuConnectionProfile,
  TcpConnectionProfile,
  Workspace,
  WorkspaceRecoveryInfo,
  AddressTransform,
  AddressTransformConfig,
} from "@mamep2026/domain";
import type { ApplicationMessage } from "@mamep2026/logging";
import {
  commLogEventFromPayload,
  createBatchId,
  electronCapabilities,
  fromResultPayload,
  toReadVerifySettingsPayload,
  toRegisterRowPayload,
  toTcpConnectionProfilePayload,
  type AppMessagePayload,
  type CommLogEventPayload,
  type MamepHostApi,
  type MamepHostEvent,
  type OpenTextFileResponse,
  type PluginContributionQueryResponse,
  type PluginRpcPayload,
  type PluginRuntimeLoadPayload,
  type PluginRuntimeUnloadPayload,
  type PollResultEventPayload,
  type SaveTextFileResponse,
  type SerialDeviceHandle,
  type SerialPortOption,
  type TraceSamplePayload,
} from "@mamep2026/platform-api";
import type {
  PluginExecutionMode,
  PluginManifest,
  PluginRegistry,
  PluginStorePort,
  PluginHostSyncRegistries,
} from "@mamep2026/plugin-api";
import {
  BrowserPlatformHost,
  usbDeviceLabel,
  type Serial,
  type SerialPort,
  type WebSerialHandle,
} from "@mamep2026/platform-web";
import type { SaveStatus, WorkspaceRepositoryPort } from "@mamep2026/workspace";
import type {
  ClipboardHost,
  CommProperties,
  CommunicationHost,
  FileHost,
  HostIdentity,
  LoggingHost,
  PlatformLifecycleHost,
  PluginHost,
  PollingHost,
  TraceHost,
  TraceSampleEvent,
  WorkspaceHost,
} from "@mamep2026/ui";
import { BrowserAppHost, deriveCapabilities } from "./AppHost";
import { BridgePluginStore } from "./bridge-plugin-store";
import { FileWorkspaceRepository } from "./file-workspace-repository";

/** ElectronAppHost 可注入依赖（测试用；生产走默认装配）。 */
export interface ElectronAppHostOptions {
  /** Web Serial 对象（默认 navigator.serial；测试注入 fake）。 */
  serial?: Serial | undefined;
  /** 工作区仓储（默认主进程文件仓储 FileWorkspaceRepository；测试注入内存仓储）。 */
  repository?: WorkspaceRepositoryPort | undefined;
  /** 插件存储（默认 BridgePluginStore 经 preload 桥；测试注入内存仓储）。 */
  pluginStore?: PluginStorePort | undefined;
  /** codec 注册表：RTU 本地路径复用浏览器 AppHost，按活动表协议路由。 */
  codecRegistry?: CodecRegistry | undefined;
  /** 同步贡献注册面：透传 inner，供插件 activate 经 ctx.registries 注册。 */
  syncRegistries?: PluginHostSyncRegistries | undefined;
  /** 地址变换解析：透传 inner（RTU 本地会话按表应用）。 */
  resolveAddressTransform?: (transformId: string) => AddressTransform | null;
}

export class ElectronAppHost
  implements
    HostIdentity,
    WorkspaceHost,
    CommunicationHost,
    PollingHost,
    TraceHost,
    LoggingHost,
    ClipboardHost,
    FileHost,
    PluginHost,
    PlatformLifecycleHost
{
  /** 能力矩阵派生：基础能力 + 已启用插件贡献的协议扩展 / 表类型。 */
  get capabilities(): PlatformCapabilities {
    return deriveCapabilities(electronCapabilities, this.pluginRegistry);
  }
  readonly isMockMode = false;
  /** 桌面端不走浏览器兼容性提示（串口能力经能力矩阵声明）。 */
  readonly browserCompatibility: BrowserCompatibility | null = null;
  readonly pluginRegistry: PluginRegistry;
  readonly appVersion = __APP_VERSION__;
  readonly platform = "electron" as const;

  private readonly bridge: MamepHostApi;
  /** 主进程桥事件退订（dispose 时调用；StrictMode 重复挂载时保证旧 host 不再接收事件）。 */
  private readonly disposeBridgeEvents: () => void;
  private readonly platformHost: BrowserPlatformHost;
  private readonly inner: BrowserAppHost;
  private readonly serial: Serial | undefined;

  /** 挂起的选择会话：enumerateSerialPorts 触发的 requestPort()（等待主进程 callback 后 resolve）。 */
  private pendingRequestPort: Promise<SerialPort> | null = null;
  /** enumerateSerialPorts 等待 serial-ports-available 事件（主进程转发端口列表）的 resolver。 */
  private pendingPortsResolve: ((ports: SerialPortOption[]) => void) | null =
    null;
  /**
   * 已授权端口快照（getPorts / requestPort 直接 resolve 的端口）：
   * requestPort 未经主进程事件直接 resolve 时（测试 fake 等），以此为下拉选项并映射端口对象。
   */
  private authorizedPorts: SerialPort[] = [];
  /** 已选端口标签（Electron 枚举路径下覆盖 inner 的记录）。 */
  private portLabel: string | null = null;

  // ---- 混合模式（两端 TCP 接线）：RTU 本地（inner）/ TCP 主进程远程代理 ----
  /** 当前活动协议（RTU 复用浏览器 Web Serial 路径；TCP 走主进程远程会话）。 */
  private activeProtocol: "rtu" | "tcp" | null = null;
  /** TCP 连接配置本地镜像（通信属性摘要用）。 */
  private tcpProfile: TcpConnectionProfile | null = null;
  private tcpAddressTransform: AddressTransformConfig | null = null;
  private currentTcpUnitId = 0;
  /** TCP 连接状态本地镜像（connection-state 事件刷新）。 */
  private tcpConnectionState: ConnectionState = "disconnected";
  private readonly connectionListeners = new Set<
    (state: ConnectionState) => void
  >();
  private readonly commLogListeners = new Set<
    (event: CommunicationLogEvent) => void
  >();
  private readonly messageListeners = new Set<
    (message: ApplicationMessage) => void
  >();
  private readonly pollResultListeners = new Set<
    (event: PollResultEvent) => void
  >();
  private readonly traceListeners = new Set<
    (sample: TraceSampleEvent) => void
  >();

  constructor(bridge: MamepHostApi, options: ElectronAppHostOptions = {}) {
    this.bridge = bridge;
    this.serial = options.serial ?? navigator.serial;
    // 串口（enumerated）：Renderer 的 Chromium 即支持 navigator.serial，连接/读写仍复用
    // 浏览器 Web Serial 路径；串口使用下拉框枚举（主进程 select-serial-port
    // 转发端口列表 → serial-ports-available 事件 → 用户选择 → selectSerialPort 回传）。
    this.platformHost = new BrowserPlatformHost({ serial: this.serial });
    this.inner = new BrowserAppHost({
      platform: this.platformHost,
      // 工作区持久化：主进程文件仓储薄桥（userData 目录版本化 JSON）。
      repository: options.repository ?? new FileWorkspaceRepository(bridge),
      mockTransport: false,
      // 插件持久化：主进程插件存储薄桥（userData 目录 plugins.json）。
      pluginStore: options.pluginStore ?? new BridgePluginStore(bridge),
      // codec 注册表：RTU 本地路径复用浏览器 AppHost。
      codecRegistry: options.codecRegistry,
      // 同步贡献注册面 + 地址变换解析。
      syncRegistries: options.syncRegistries,
      resolveAddressTransform: options.resolveAddressTransform,
    });
    this.pluginRegistry = this.inner.pluginRegistry;
    // RTU 本地会话事件（inner）转发到本 Host 的合并订阅集合（TCP 远程事件同样转发）。
    this.inner.subscribeConnectionState((state) => {
      for (const listener of this.connectionListeners) listener(state);
    });
    this.inner.subscribeCommLog((event) => {
      for (const listener of this.commLogListeners) listener(event);
    });
    this.inner.subscribeMessage((message) => {
      for (const listener of this.messageListeners) listener(message);
    });
    this.inner.subscribePollResult((pollResult) => {
      for (const listener of this.pollResultListeners) listener(pollResult);
    });
    this.inner.subscribeTraceSample((sample) => {
      for (const listener of this.traceListeners) listener(sample);
    });
    // 订阅主进程事件：serial-ports-available 携带可用端口列表（交给挂起的枚举）；
    // 主进程 TCP 会话事件（comm-log/poll-result/trace-sample/app-message/connection-state）
    // 转发到本 Host 的合并订阅集合。
    this.disposeBridgeEvents = bridge.onEvent((event: MamepHostEvent) => {
      if (event.kind === "serial-ports-available") {
        const { ports } = event.payload as { ports: SerialPortOption[] };
        this.pendingPortsResolve?.(ports);
        this.pendingPortsResolve = null;
        return;
      }
      this.handleSessionEvent(event);
    });
  }

  /** 主进程 TCP 会话事件分发：更新本地镜像并通知订阅者（payload 形状由 kind 契约保证）。 */
  private handleSessionEvent(event: MamepHostEvent): void {
    switch (event.kind) {
      case "plugin-host-state":
        this.pluginRegistry.applyHostSnapshot(event.payload);
        break;
      case "connection-state": {
        const { state } = event.payload as { state: ConnectionState };
        this.tcpConnectionState = state;
        for (const listener of this.connectionListeners) listener(state);
        break;
      }
      case "comm-log": {
        const { event: payload } = event.payload as {
          event: CommLogEventPayload;
        };
        const logEvent = commLogEventFromPayload(payload);
        for (const listener of this.commLogListeners) listener(logEvent);
        break;
      }
      case "poll-result": {
        const payload = event.payload as PollResultEventPayload;
        const pollResult: PollResultEvent = {
          key: payload.key,
          sheetId: payload.sheetId,
          address: payload.address,
          route: payload.route,
          requestGeneration: payload.requestGeneration,
          connectionGeneration: payload.connectionGeneration,
          result: fromResultPayload(payload.result),
        };
        for (const listener of this.pollResultListeners) listener(pollResult);
        break;
      }
      case "trace-sample": {
        const { sample } = event.payload as { sample: TraceSamplePayload };
        for (const listener of this.traceListeners) listener(sample);
        break;
      }
      case "app-message": {
        const { message } = event.payload as { message: AppMessagePayload };
        const appMessage: ApplicationMessage = {
          timestamp: message.timestamp,
          level: message.level,
          messageKey: message.messageKey,
          detail: message.detail,
          ...(message.params !== undefined ? { params: message.params } : {}),
        };
        for (const listener of this.messageListeners) listener(appMessage);
        break;
      }
      default:
        break;
    }
  }

  // ---- 串口选择（enumerated：主进程转发列表 + 下拉框选择）----

  async enumerateSerialPorts(): Promise<Result<SerialPortOption[]>> {
    const serial = this.serial;
    if (serial === undefined) {
      return fail(
        createMamepError({
          code: "WEB_SERIAL_UNSUPPORTED",
          category: "capability",
          userMessageKey: "errors.webSerialUnsupported",
          technicalMessage: "Web Serial API is not supported in this context",
        }),
      );
    }
    // 若上次枚举的选择会话仍挂起，先取消，避免多个 requestPort 同时挂起。
    await this.cancelPendingPicker();
    // 触发系统枚举：requestPort() → 主进程 select-serial-port → 转发端口列表（事件）；
    // 若 requestPort 直接 resolve（测试 fake 或无需授权的场景），则以该端口作为唯一选项。
    const pick = serial.requestPort();
    this.pendingRequestPort = pick;
    const list = await Promise.race([
      new Promise<SerialPortOption[]>((resolve) => {
        this.pendingPortsResolve = resolve;
      }),
      pick.then(
        (port) => {
          this.pendingRequestPort = null;
          this.authorizedPorts = [port];
          return [this.toPortOption(port, 0)];
        },
        () => {
          // requestPort 直接失败（取消/无可用设备）：无端口可枚举。
          this.pendingRequestPort = null;
          return [];
        },
      ),
    ]);
    return { ok: true, value: list };
  }

  async selectSerialPort(
    portId?: string | null,
  ): Promise<Result<SerialDeviceHandle | null>> {
    const serial = this.serial;
    if (serial === undefined) {
      return fail(
        createMamepError({
          code: "WEB_SERIAL_UNSUPPORTED",
          category: "capability",
          userMessageKey: "errors.webSerialUnsupported",
          technicalMessage: "Web Serial API is not supported in this context",
        }),
      );
    }
    // 路径 1：挂起选择会话（主进程转发了完整端口列表）→ 回传选择给主进程解析 callback。
    if (this.pendingRequestPort !== null) {
      const pick = this.pendingRequestPort;
      this.pendingRequestPort = null;
      const bridgeResult = await this.bridge.selectSerialPort(portId ?? "");
      if (!bridgeResult.ok) return bridgeResult;
      try {
        const port = await pick;
        const label = usbDeviceLabel(port.getInfo());
        this.portLabel = label;
        const handle: WebSerialHandle = { id: label, label, port };
        return { ok: true, value: handle };
      } catch (cause) {
        // 主进程 callback("")（用户取消）→ requestPort reject NotFoundError → ok(null)。
        if (cause instanceof DOMException && cause.name === "NotFoundError") {
          return { ok: true, value: null };
        }
        return fail(
          createMamepError({
            code: "SERIAL_REQUEST_FAILED",
            category: "permission",
            userMessageKey: "errors.serialRequestFailed",
            technicalMessage:
              cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
        );
      }
    }
    // 路径 2：无挂起会话（requestPort 直接 resolve 的已授权快照，如测试 fake）→ 直接取端口。
    const index = Number.parseInt(portId ?? "", 10);
    const port = Number.isNaN(index) ? undefined : this.authorizedPorts[index];
    if (port === undefined) {
      // 无效/取消选择。
      return { ok: true, value: null };
    }
    const label = usbDeviceLabel(port.getInfo());
    this.portLabel = label;
    const handle: WebSerialHandle = { id: label, label, port };
    return { ok: true, value: handle };
  }

  /** 取消挂起的选择会话（重枚举/关闭弹窗时调用）；无挂起会话则无操作。 */
  private async cancelPendingPicker(): Promise<void> {
    const pick = this.pendingRequestPort;
    if (pick === null) return;
    this.pendingRequestPort = null;
    this.pendingPortsResolve = null;
    // 通知主进程取消（空串 = 取消）；主进程无挂起请求时返回错误，忽略即可。
    await this.bridge.selectSerialPort("").catch(() => undefined);
    // 吞掉挂起 requestPort 的拒绝（NotFoundError），避免 unhandled rejection。
    await pick.catch(() => undefined);
  }

  private toPortOption(port: SerialPort, index: number): SerialPortOption {
    return { portId: String(index), label: usbDeviceLabel(port.getInfo()) };
  }

  // ---- 工作区（复用浏览器路径：IndexedDB 自动保存/会话恢复，与浏览器一致）----

  loadWorkspace(): Promise<Result<Workspace>> {
    return this.inner.loadWorkspace();
  }

  recoverWorkspace(): Promise<Result<Workspace>> {
    return this.inner.recoverWorkspace();
  }

  exportWorkspaceRecovery(): Promise<Result<string>> {
    return this.inner.exportWorkspaceRecovery();
  }

  resetWorkspace(): Promise<Result<Workspace>> {
    return this.inner.resetWorkspace();
  }

  scheduleSave(workspace: Workspace): void {
    this.inner.scheduleSave(workspace);
  }

  flush(): Promise<Result<void>> {
    return this.inner.flush();
  }

  getWorkspaceRecoveryInfo(): WorkspaceRecoveryInfo | null {
    return this.inner.getWorkspaceRecoveryInfo();
  }

  getSaveStatus(): SaveStatus {
    return this.inner.getSaveStatus();
  }

  subscribeSaveStatus(listener: (status: SaveStatus) => void): () => void {
    return this.inner.subscribeSaveStatus(listener);
  }

  // ---- 连接（复用浏览器 Web Serial 传输路径；串口选择为 enumerated 下拉框）----

  supportsWebSerial(): boolean {
    // 以注入/装配的 serial 为准（生产为 navigator.serial），不依赖全局 navigator 探测。
    return this.platformHost.supportsWebSerial;
  }

  async connect(
    profile: RtuConnectionProfile,
    handle: SerialDeviceHandle | null,
    options?: { protocol?: string },
  ): Promise<Result<void>> {
    const result = await this.inner.connect(profile, handle, options);
    // RTU 路径恒为 rtu（codec 协议如 MEMOBUS 亦走 RTU 串口传输，activeProtocol 仅 rtu/tcp 判别）。
    if (result.ok) {
      this.activeProtocol = "rtu";
      this.pluginRegistry.configureHostContributions(false);
    }
    return result;
  }

  /**
   * TCP 连接（两端 TCP 接线）：会话承载在主进程（ElectronSessionHost），
   * 本方法经 bridge.sessionTcpConnect 远程代理；连接后的读写/轮询/Trace 亦走主进程。
   */
  async connectTcp(profile: TcpConnectionProfile): Promise<Result<void>> {
    const result = await this.bridge
      .sessionTcpConnect({ profile: toTcpConnectionProfilePayload(profile) })
      .then((r) => {
        if (!r.ok) return r;
        this.tcpProfile = { ...profile };
        this.currentTcpUnitId = profile.unitId;
        this.portLabel = `${profile.host}:${profile.port}`;
        this.tcpConnectionState = "connected";
        this.activeProtocol = "tcp";
        this.pluginRegistry.configureHostContributions(true);
        return { ok: true, value: undefined } as const;
      });
    return result;
  }

  async disconnect(): Promise<Result<void>> {
    if (this.activeProtocol === "tcp") {
      const result = await this.bridge.sessionDisconnect();
      if (result.ok) {
        this.tcpConnectionState = "disconnected";
        this.activeProtocol = null;
        this.pluginRegistry.configureHostContributions(false);
        return ok(undefined);
      }
      return result;
    }
    return this.inner.disconnect();
  }

  /**
   * 释放全部资源（StrictMode 重复挂载 / 卸载清理）：退订主进程桥事件、清空本地订阅
   * 集合、取消挂起选择会话并 dispose inner，避免事件重复投递（comm-log 一条变两条）
   * 的根因。
   */
  async dispose(): Promise<void> {
    this.disposeBridgeEvents();
    this.connectionListeners.clear();
    this.commLogListeners.clear();
    this.messageListeners.clear();
    this.pollResultListeners.clear();
    this.traceListeners.clear();
    await this.cancelPendingPicker();
    await this.inner.dispose();
    this.activeProtocol = null;
    this.pluginRegistry.configureHostContributions(false);
    this.tcpProfile = null;
    this.tcpConnectionState = "disconnected";
  }

  getConnectionState(): ConnectionState {
    return this.activeProtocol === "tcp"
      ? this.tcpConnectionState
      : this.inner.getConnectionState();
  }

  /** 启动插件系统：委托 inner（加载已安装插件并装配执行面）。 */
  async startPlugins(): Promise<void> {
    await this.inner.startPlugins();
    const result = await this.bridge.hostPluginState?.();
    if (result?.ok) this.pluginRegistry.applyHostSnapshot(result.value);
    else if (result !== undefined)
      this.pluginRegistry.reportHostQueryError(result.error);
  }

  /** Retry host execution without changing installed content or saved consent. */
  async reloadHostPlugin(pluginId: string): Promise<Result<void>> {
    const saved = await this.inner.flushPlugins();
    if (!saved.ok) return saved;
    const result = await this.bridge.reloadHostPlugin?.(pluginId);
    if (result === undefined)
      return fail(pluginPermissionDenied("host plugin reload unavailable"));
    if (!result.ok) {
      this.pluginRegistry.reportHostQueryError(result.error);
      return result;
    }
    this.pluginRegistry.applyHostSnapshot(result.value);
    return ok(undefined);
  }

  /** 预览可执行插件 entry。 */
  previewPluginEntry(
    entrySource: string,
    executionMode: PluginExecutionMode,
    signal?: AbortSignal,
  ): Promise<Result<PluginManifest>> {
    return this.inner.previewPluginEntry(entrySource, executionMode, signal);
  }

  /** 安装可执行插件：委托 inner（注册 + 持久化）。 */
  async setPluginEnabled(
    pluginId: string,
    enabled: boolean,
  ): Promise<Result<void>> {
    const result = await this.inner.setPluginEnabled(pluginId, enabled);
    if (!result.ok) return result;
    return this.inner.flushPlugins();
  }

  async installPluginEntry(
    entrySource: string,
    executionMode: PluginExecutionMode,
  ): Promise<Result<PluginManifest>> {
    const result = await this.inner.installPluginEntry(
      entrySource,
      executionMode,
    );
    if (!result.ok) return result;
    const saved = await this.inner.flushPlugins();
    return saved.ok ? result : saved;
  }

  /** 当前会话：RTU 本地路径返回内部会话；TCP 在主进程 → null。 */
  getSession(): CommunicationSession | null {
    return this.activeProtocol === "tcp" ? null : this.inner.getSession();
  }

  getCommProperties(): CommProperties {
    if (this.activeProtocol === "tcp") {
      const profile = this.tcpProfile;
      return {
        protocol: "tcp",
        portLabel: this.portLabel,
        unitId: profile?.unitId ?? 0,
        baudRate: 0,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "off",
        timeoutMs:
          profile?.requestTimeoutMs ?? defaultConfig.tcp.requestTimeoutMs,
        retryCount: profile?.retryCount ?? 1,
        connectionState: this.tcpConnectionState,
      };
    }
    const props = this.inner.getCommProperties();
    // 枚举路径的已选端口标签由本 Host 记录（inner 仅在浏览器路径自行记录）。
    return {
      ...props,
      protocol: "rtu",
      portLabel: this.portLabel ?? props.portLabel,
    };
  }

  /**
   * 从站地址 / TCP Unit ID 会话内动态修改（已知限制打通）：
   * RTU 本地路径（inner）；TCP 经 session-set-unit-id 远程代理主进程。
   */
  setSlaveAddress(slave: number): void {
    if (this.activeProtocol === "tcp") {
      void this.bridge.sessionSetUnitId(slave);
      this.currentTcpUnitId = slave;
    } else {
      this.inner.setSlaveAddress(slave);
    }
  }

  private fallbackRoute(): RequestRoute {
    if (this.activeProtocol === "tcp") {
      return {
        unitAddress: this.currentTcpUnitId,
        protocol: this.tcpProfile?.codecId ?? "tcp",
        addressTransform: this.tcpAddressTransform,
      };
    }
    return (
      this.inner.getSession()?.getCurrentRoute() ?? {
        unitAddress: 1,
        protocol: "rtu",
      }
    );
  }

  /** Cache the active TCP table mapping for fallback requests; RTU remains local. */
  setAddressTransform(
    config: {
      transformId: string;
      enabled: boolean;
      parameters?:
        Readonly<Record<string, string | number | boolean>> | undefined;
    } | null,
  ): void {
    this.tcpAddressTransform =
      config === null
        ? null
        : {
            ...config,
            ...(config.parameters
              ? { parameters: { ...config.parameters } }
              : {}),
          };
    if (this.activeProtocol !== "tcp") {
      this.inner.setAddressTransform(config);
    }
  }

  subscribeConnectionState(
    listener: (state: ConnectionState) => void,
  ): () => void {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  // ---- 设备请求（统一调度器）：RTU 复用浏览器路径（inner）/ TCP 走主进程远程会话 ----

  readRow(
    row: RegisterRow,
    route?: RequestRoute,
  ): Promise<Result<number | number[]>> {
    if (this.activeProtocol === "tcp") {
      return this.bridge.sessionReadRow(
        toRegisterRowPayload(row),
        route ?? this.fallbackRoute(),
      );
    }
    return this.inner.readRow(row, route ?? this.fallbackRoute());
  }

  writeRow(
    row: RegisterRow,
    options?: { writeVerify?: ReadVerifySettings },
    route?: RequestRoute,
  ): Promise<Result<WriteOutcome>> {
    if (this.activeProtocol === "tcp") {
      return this.bridge.sessionWriteRow(
        toRegisterRowPayload(row),
        options?.writeVerify !== undefined
          ? toReadVerifySettingsPayload(options.writeVerify)
          : undefined,
        route ?? this.fallbackRoute(),
      );
    }
    return this.inner.writeRow(row, options, route ?? this.fallbackRoute());
  }

  readAllRows(rows: BatchReadRow[], route?: RequestRoute): BatchReadHandle {
    if (this.activeProtocol === "tcp") {
      // 远程批任务：batchId 由渲染端生成，取消经 session-batch-cancel RPC 通知主进程。
      const batchId = createBatchId();
      const handle = this.bridge.sessionBatchRead(
        batchId,
        rows.map((r) => ({
          key: r.key,
          sheetId: r.sheetId,
          address: r.address,
          ...(r.quantity !== undefined && r.quantity > 1
            ? { quantity: r.quantity }
            : {}),
        })),
        route ?? this.fallbackRoute(),
      );
      return {
        promise: handle.then((result) =>
          result.ok
            ? { ok: true as const, value: result.value.summary }
            : result,
        ),
        cancel: () => {
          // 幂等、异常安全：完成/未知 batchId 为 no-op，不抛错。
          void this.bridge.sessionBatchCancel(batchId);
        },
      };
    }
    return this.inner.readAllRows(rows, route ?? this.fallbackRoute());
  }

  // ---- 轮询 / Trace / 日志：RTU 复用浏览器路径（inner）/ TCP 走主进程远程会话 ----

  updatePollingTargets(
    rows: Array<{
      key: string;
      sheetId: string;
      address: number;
      quantity?: number;
      route?: RequestRoute;
    }>,
  ): void {
    if (this.activeProtocol === "tcp") {
      const fallback = this.fallbackRoute();
      void this.bridge.sessionUpdatePollingTargets(
        rows.map((row) => ({
          ...row,
          route: row.route ?? fallback,
        })),
      );
      return;
    }
    this.inner.updatePollingTargets(rows);
  }

  startPolling(): void {
    if (this.activeProtocol === "tcp") {
      void this.bridge.sessionPollingStart();
      return;
    }
    this.inner.startPolling();
  }

  stopPolling(): void {
    if (this.activeProtocol === "tcp") {
      void this.bridge.sessionPollingStop();
      return;
    }
    this.inner.stopPolling();
  }

  subscribePollResult(listener: (event: PollResultEvent) => void): () => void {
    this.pollResultListeners.add(listener);
    return () => {
      this.pollResultListeners.delete(listener);
    };
  }

  traceStart(
    key: string,
    address: number,
    speedMs: number,
    quantity = 1,
    route?: RequestRoute,
    identity?: TraceIdentity,
  ): void {
    if (this.activeProtocol === "tcp") {
      void this.bridge.sessionTraceStart(
        key,
        address,
        speedMs,
        quantity,
        route ?? this.fallbackRoute(),
        identity,
      );
      return;
    }
    this.inner.traceStart(
      key,
      address,
      speedMs,
      quantity,
      route ?? this.fallbackRoute(),
      identity,
    );
  }

  traceStop(key: string): void {
    if (this.activeProtocol === "tcp") {
      void this.bridge.sessionTraceStop(key);
      return;
    }
    this.inner.traceStop(key);
  }

  subscribeTraceSample(
    listener: (sample: TraceSampleEvent) => void,
  ): () => void {
    this.traceListeners.add(listener);
    return () => {
      this.traceListeners.delete(listener);
    };
  }

  subscribeCommLog(
    listener: (event: CommunicationLogEvent) => void,
  ): () => void {
    this.commLogListeners.add(listener);
    return () => {
      this.commLogListeners.delete(listener);
    };
  }

  subscribeMessage(
    listener: (message: ApplicationMessage) => void,
  ): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  pushMessage(
    level: "info" | "warning" | "error",
    messageKey: string,
    detail?: string,
  ): void {
    this.inner.pushMessage(level, messageKey, detail);
  }

  // ---- 剪贴板（真实能力，经主进程 preload 桥）----

  copyTextToClipboard(text: string): Promise<Result<void>> {
    return this.bridge.copyTextToClipboard(text);
  }

  readTextFromClipboard(): Promise<Result<string | null>> {
    return this.bridge.readTextFromClipboard();
  }

  // ---- 通信日志 CSV 导出（PRD §8.3 P1）：主进程保存对话框 + fs 落盘 ----

  saveTextFile(options: {
    suggestedName: string;
    content: string;
    mimeType?: string;
  }): Promise<Result<SaveTextFileResponse>> {
    return this.bridge.saveTextFile(options);
  }

  // ---- 工作区导入（PRD §8.3 P1）：主进程打开对话框 + fs 读取 ----

  openTextFile(options?: {
    suggestedName?: string;
  }): Promise<Result<OpenTextFileResponse>> {
    return this.bridge.openTextFile(options);
  }

  // ---- 插件运行时桥：主进程返回能力错误，委托桥契约就位 ----

  pluginRuntimeLoad(payload: PluginRuntimeLoadPayload): Promise<Result<null>> {
    return this.bridge.pluginRuntimeLoad(payload);
  }

  pluginRuntimeUnload(
    payload: PluginRuntimeUnloadPayload,
  ): Promise<Result<null>> {
    return this.bridge.pluginRuntimeUnload(payload);
  }

  pluginRpc(payload: PluginRpcPayload): Promise<Result<unknown>> {
    return this.bridge.pluginRpc(payload);
  }

  pluginContributionQuery(payload?: {
    pointId?: string;
  }): Promise<Result<PluginContributionQueryResponse>> {
    return this.bridge.pluginContributionQuery(payload);
  }
}
