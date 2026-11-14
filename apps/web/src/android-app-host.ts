/**
 * Android WebView Host（ADR-050 §3、§4）。
 *
 * **本地混合宿主**（与 `ElectronAppHost` 同构，但全部在同进程内）：
 * - 通用能力（工作区/插件/剪贴板/消息/日志存储/`MockTransport`）委托 `BrowserAppHost`（inner）；
 * - 会话按协议路由：RTU 走 inner（Phase 1 无串口，能力矩阵如实声明不支持），TCP 走本地
 *   `TcpSessionHost` + `CapacitorTcpTransport`（原生 socket 经 Capacitor 桥）。
 *
 * 为什么不像 VSCode 那样把会话下沉原生：Webview 的 `navigator.serial` 被权限策略拒绝才必须下沉，
 * Android 无此约束；会话留在 JS 才能 100% 复用 `packages/application` 的调度与协调器（ADR-050 §4）。
 *
 * 边界：**本类不直接调用 Capacitor 插件**——传输桥由 composition root 注入（`platform-android`）。
 */
import type {
  AddressTransform,
  PlatformCapabilities,
  ReadVerifySettings,
  RegisterRow,
  RequestRoute,
  Result,
  RtuConnectionProfile,
  TcpConnectionProfile,
  Workspace,
  WorkspaceRecoveryInfo,
} from "@mamep2026/domain";
import { createMamepError, defaultConfig, fail, ok } from "@mamep2026/domain";
import type {
  BatchReadHandle,
  BatchReadRow,
  Clock,
  CodecRegistry,
  CommunicationLogEvent,
  CommunicationSession,
  ConnectionState,
  WriteOutcome,
} from "@mamep2026/communication";
import { TcpSessionHost } from "@mamep2026/application";
import type { ApplicationMessage } from "@mamep2026/logging";
import type {
  OpenTextFileResponse,
  PlatformHost,
  PluginContributionQueryResponse,
  PluginRpcPayload,
  PluginRuntimeLoadPayload,
  PluginRuntimeUnloadPayload,
  SaveTextFileResponse,
  SerialDeviceHandle,
  SerialPortOption,
} from "@mamep2026/platform-api";
import type {
  PluginExecutionMode,
  PluginManifest,
  PluginRegistry,
  PluginRuntime,
  PluginStorePort,
  PluginSyncRegistries,
} from "@mamep2026/plugin-api";
import type { SaveStatus, WorkspaceRepositoryPort } from "@mamep2026/workspace";
import type { AppHost, CommProperties, TraceSampleEvent } from "@mamep2026/ui";
import {
  AndroidPlatformHost,
  androidCapabilities,
  applyAndroidTcpDefaults,
  serialUnsupportedError,
  type AndroidAppLifecycleBridge,
  type MamepTransportBridge,
} from "@mamep2026/platform-android";
import { BrowserAppHost, deriveCapabilities } from "./AppHost";

export interface AndroidAppHostOptions {
  /** 传输桥（生产 = `createCapacitorTransportBridge()`，由 composition root 注入；测试注入 fake）。 */
  bridge: MamepTransportBridge;
  repository: WorkspaceRepositoryPort;
  pluginStore?: PluginStorePort | undefined;
  codecRegistry?: CodecRegistry | undefined;
  /** 同步贡献注册面（ADR-054）：透传 inner，供插件 activate 经 ctx.registries 注册。 */
  syncRegistries?: PluginSyncRegistries | undefined;
  resolveAddressTransform?:
    ((transformId: string) => AddressTransform | null) | undefined;
  /** 平台宿主（默认用注入的 bridge 构造 `AndroidPlatformHost`；测试可注入）。 */
  platformHost?: PlatformHost | undefined;
  /** 时钟（默认取平台宿主时钟）。 */
  clock?: Clock | undefined;
  /** dev mock 传输（`?mockTransport=1`）；Android 正常情况下为 false。 */
  mockTransport?: boolean | undefined;
  /**
   * 应用生命周期桥（`@capacitor/app`，ADR-050 Phase 3）：硬件返回键 + 前后台状态。
   * 生产 = `createCapacitorAppLifecycleBridge()`（composition root 注入）；测试注入 fake。
   */
  appLifecycle?: AndroidAppLifecycleBridge | null | undefined;
  /**
   * 基础能力矩阵（ADR-056）：`executablePlugins` 由装配期运行时探测决定，故由 composition root
   * 经 `resolveAndroidHostCapabilities()` 注入；缺省为静态 `androidCapabilities`
   * （fail-closed，不误报可执行插件）。
   */
  capabilities?: PlatformCapabilities | undefined;
}

export class AndroidAppHost implements AppHost {
  /** 基础能力（ADR-056）：装配期由 composition root 注入（含运行时探测结果）。 */
  private readonly baseCapabilities: PlatformCapabilities;
  /** 能力矩阵派生（ADR-054）：基础能力 + 已启用插件贡献的协议扩展 / 表类型。 */
  get capabilities(): PlatformCapabilities {
    return deriveCapabilities(this.baseCapabilities, this.pluginRegistry);
  }
  readonly isMockMode: boolean;
  /** Android 不走浏览器 Web Serial 兼容性提示（串口能力由能力矩阵如实声明）。 */
  readonly browserCompatibility = null;
  readonly pluginRegistry: PluginRegistry;
  readonly appVersion = __APP_VERSION__;
  readonly platform = "android" as const;

  private readonly platformHost: PlatformHost;
  private readonly inner: BrowserAppHost;
  private readonly tcp: TcpSessionHost;
  /** 平台宿主的串口面（enumerated 平台专用）；注入的自定义宿主不提供则为 null。 */
  private readonly serialHost: AndroidSerialHostPort | null;
  /** 应用生命周期桥（`@capacitor/app`，ADR-050 Phase 3）；未注入时为 null（无硬件返回键）。 */
  private readonly appLifecycle: AndroidAppLifecycleBridge | null;

  /** 当前活动协议（Phase 1 仅 tcp 可达；rtu 保留以便 Phase 2 直接复用）。 */
  private activeProtocol: "rtu" | "tcp" | null = null;
  /** TCP 连接配置本地镜像（通信属性摘要用）。 */
  private tcpProfile: TcpConnectionProfile | null = null;
  private currentTcpUnitId = 0;
  private tcpConnectionState: ConnectionState = "disconnected";
  /** 已选串口标签（enumerated 路径由本 Host 记录，供通信属性与 bottom panel 展示）。 */
  private portLabel: string | null = null;

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
    (key: string, address: number, result: Result<number | number[]>) => void
  >();
  private readonly traceListeners = new Set<
    (sample: TraceSampleEvent) => void
  >();

  constructor(options: AndroidAppHostOptions) {
    const platformHost =
      options.platformHost ??
      new AndroidPlatformHost({ bridge: options.bridge });
    this.platformHost = platformHost;
    this.serialHost = hasSerialApi(platformHost) ? platformHost : null;
    this.appLifecycle = options.appLifecycle ?? null;
    this.isMockMode = options.mockTransport === true;
    this.baseCapabilities = options.capabilities ?? androidCapabilities;

    this.inner = new BrowserAppHost({
      // 能力矩阵如实传递给 inner（UI 依据 `host.capabilities` 门控 RTU/TCP 入口/插件安装）。
      capabilities: this.baseCapabilities,
      // Android 无 Web Serial：inner 的兼容性检测结果不使用（本类 browserCompatibility 恒 null）。
      compatibilityEnv: { serial: undefined, isSecureContext: true },
      platform: this.platformHost,
      repository: options.repository,
      mockTransport: false,
      ...(options.pluginStore !== undefined
        ? { pluginStore: options.pluginStore }
        : {}),
      ...(options.codecRegistry !== undefined
        ? { codecRegistry: options.codecRegistry }
        : {}),
      ...(options.syncRegistries !== undefined
        ? { syncRegistries: options.syncRegistries }
        : {}),
      ...(options.resolveAddressTransform !== undefined
        ? { resolveAddressTransform: options.resolveAddressTransform }
        : {}),
    });
    this.pluginRegistry = this.inner.pluginRegistry;

    // TCP 会话（本地）：传输经平台宿主打开；自动重连复用同一工厂（ADR-035）。
    this.tcp = new TcpSessionHost({
      clock: options.clock ?? this.platformHost.clock,
      events: {
        onLog: (event) => {
          // TCP 活动时 inner 不产生会话事件；直接转发。
          for (const listener of this.commLogListeners) listener(event);
        },
        onStateChange: (state) => {
          this.tcpConnectionState = state;
          for (const listener of this.connectionListeners) listener(state);
        },
        onPollResult: (key, address, result) => {
          for (const listener of this.pollResultListeners)
            listener(key, address, result);
        },
        onTraceSample: (sample) => {
          for (const listener of this.traceListeners) listener(sample);
        },
        onMessage: (message) => {
          for (const listener of this.messageListeners) listener(message);
        },
      },
      openTransport: (profile) => this.platformHost.openTcpTransport(profile),
    });

    // inner（RTU 侧）事件转发到本 Host 的合并订阅集合；TCP 活动时不重复上报。
    this.inner.subscribeConnectionState((state) => {
      if (this.activeProtocol === "tcp") return;
      for (const listener of this.connectionListeners) listener(state);
    });
    this.inner.subscribeCommLog((event) => {
      if (this.activeProtocol === "tcp") return;
      for (const listener of this.commLogListeners) listener(event);
    });
    this.inner.subscribeMessage((message) => {
      for (const listener of this.messageListeners) listener(message);
    });
    this.inner.subscribePollResult((key, address, result) => {
      if (this.activeProtocol === "tcp") return;
      for (const listener of this.pollResultListeners)
        listener(key, address, result);
    });
    this.inner.subscribeTraceSample((sample) => {
      if (this.activeProtocol === "tcp") return;
      for (const listener of this.traceListeners) listener(sample);
    });
  }

  // ---- 插件系统（委托 inner：加载已安装插件并装配执行面，ADR-054）----
  startPlugins(): Promise<void> {
    return this.inner.startPlugins();
  }

  // ---- 工作区（委托 inner：IndexedDB 仓储 + 自动保存，与浏览器端同路径）----
  loadWorkspace(): Promise<Result<Workspace>> {
    return this.inner.loadWorkspace();
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

  // ---- 串口（Phase 2：USB-RS485，USB Host + enumerated 下拉）----
  /** Android 无 Web Serial（能力矩阵 `serialPorts:"enumerated"`，UI 走下拉分支）。 */
  supportsWebSerial(): boolean {
    return false;
  }

  /** 枚举 USB 串口（委托平台宿主：Capacitor 桥 listSerialPorts + Zod 校验）。 */
  async enumerateSerialPorts(): Promise<Result<SerialPortOption[]>> {
    if (this.serialHost === null) {
      return fail(
        serialUnsupportedError(
          "android serial enumeration requires AndroidPlatformHost",
        ),
      );
    }
    return this.serialHost.listSerialPorts();
  }

  /** 按 portId 选择端口；成功时记录 portLabel（会话标签用）。 */
  async selectSerialPort(
    portId?: string | null,
  ): Promise<Result<SerialDeviceHandle | null>> {
    if (this.serialHost === null) {
      return fail(
        serialUnsupportedError(
          "android serial selection requires AndroidPlatformHost",
        ),
      );
    }
    const selected = await this.serialHost.selectSerialPort(portId ?? null);
    if (selected.ok && selected.value !== null) {
      this.portLabel = selected.value.label;
    } else if (selected.ok) {
      this.portLabel = null;
    }
    return selected;
  }

  /**
   * 应用进入/离开后台（ADR-050 Phase 3）：按活动协议路由到本地会话宿主。
   * 后台暂停轮询/追踪（保留配置），回前台按原配置恢复；幂等。
   */
  setBackgroundSuspended(suspended: boolean): void {
    if (this.activeProtocol === "tcp") {
      if (suspended) {
        this.tcp.pauseBackground();
      } else {
        this.tcp.resumeBackground();
      }
      return;
    }
    this.inner.setBackgroundSuspended(suspended);
  }

  /** 屏幕常亮（KeepAwake）：持续轮询/追踪期间保持屏幕不休眠（仅 Android 实现）。 */
  setKeepScreenOn(enabled: boolean): void {
    if (this.platformHost instanceof AndroidPlatformHost) {
      this.platformHost.setKeepScreenOn(enabled);
    }
  }

  /**
   * 硬件返回键（ADR-050 Phase 3）：`handler` 返回 `true`（已关掉覆盖层）时不做事；
   * 未消费时最小化应用（Android 惯例：根页面退到后台而非退出进程）。
   *
   * 桥不可用（`@capacitor/app` 未装配）时返回 `null`，调用方退回系统默认行为。
   * 订阅是异步建立的：`handler` 可能已订阅但在途，用 `disposed` 标记保证取消语义正确
   * （已取消则立即退订，不遗漏监听器）。
   */
  onHardwareBack(handler: () => boolean): (() => void) | null {
    const lifecycle = this.appLifecycle;
    if (lifecycle === null) return null;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    void lifecycle
      .onBackButton(() => {
        if (handler()) return true;
        // 未消费 → 最小化；仍回答“已处理”，避免 Capacitor 默认退出应用。
        void lifecycle.minimizeApp().catch(() => {
          // 最小化失败不阻断返回键链路（详见 capacitor-app.ts）。
        });
        return true;
      })
      .then((off) => {
        if (disposed) {
          off();
          return;
        }
        unsubscribe = off;
      })
      .catch(() => {
        // 桥不可用（插件未注册）：静默降级为无返回键拦截。
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }

  async connect(
    profile: RtuConnectionProfile,
    handle: SerialDeviceHandle | null,
    options?: { protocol?: string },
  ): Promise<Result<void>> {
    // RTU 本地路径：传输由 inner（BrowserAppHost）经平台宿主 openSerialTransport 打开，
    // 会话/调度复用共享 RtuSessionHost（与三端同源）。
    const result = await this.inner.connect(profile, handle, options);
    if (result.ok) this.activeProtocol = "rtu";
    return result;
  }

  async connectTcp(profile: TcpConnectionProfile): Promise<Result<void>> {
    // Android 默认连接参数（ADR-050）：仅覆盖「仍为库默认值」的项，用户改过的值保留。
    const effective = applyAndroidTcpDefaults(profile);
    const openResult = await this.platformHost.openTcpTransport(effective);
    if (!openResult.ok) return fail(openResult.error);

    const result = await this.tcp.connect({
      profile: effective,
      transport: openResult.value,
      portLabel: `${effective.host}:${effective.port}`,
    });
    if (!result.ok) return result;

    this.tcpProfile = effective;
    this.currentTcpUnitId = effective.unitId;
    this.activeProtocol = "tcp";
    return ok(undefined);
  }

  async disconnect(): Promise<Result<void>> {
    if (this.activeProtocol === "tcp") {
      const result = await this.tcp.disconnect();
      this.activeProtocol = null;
      this.tcpConnectionState = "disconnected";
      return result;
    }
    return this.inner.disconnect();
  }

  getConnectionState(): ConnectionState {
    return this.activeProtocol === "tcp"
      ? this.tcpConnectionState
      : this.inner.getConnectionState();
  }

  getCommProperties(): CommProperties {
    if (this.activeProtocol === "tcp") {
      const profile = this.tcpProfile;
      return {
        protocol: "tcp",
        portLabel: profile === null ? null : `${profile.host}:${profile.port}`,
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
    // 枚举路径的已选端口标签由本 Host 记录（inner 仅在浏览器路径自行记录）；与 ElectronAppHost 同因。
    return {
      ...props,
      protocol: "rtu",
      portLabel: this.portLabel ?? props.portLabel,
    };
  }

  setSlaveAddress(slave: number): void {
    // TCP 的「从站地址」即 Unit ID（每表独立，ADR-026）。
    if (this.activeProtocol === "tcp") {
      this.tcp.setUnitId(slave);
      this.currentTcpUnitId = slave;
    } else {
      this.inner.setSlaveAddress(slave);
    }
  }

  private fallbackRoute(): RequestRoute {
    if (this.activeProtocol === "tcp") {
      return { unitAddress: this.currentTcpUnitId, protocol: "tcp" };
    }
    return (
      this.inner.getSession()?.getCurrentRoute() ?? {
        unitAddress: 1,
        protocol: "rtu",
      }
    );
  }

  setAddressTransform(
    config: { transformId: string; enabled: boolean } | null,
  ): void {
    // TCP 无地址变换（与 TcpSessionHost 语义一致）。
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

  getSession(): CommunicationSession | null {
    // 与 Electron TCP 路径一致：插件通信面在 TCP 活动时不可用（Phase 1 不新增远程会话面）。
    return this.activeProtocol === "tcp" ? null : this.inner.getSession();
  }

  /** 预览可执行插件 entry（ADR-054）。 */
  previewPluginEntry(
    entrySource: string,
    executionMode: PluginExecutionMode,
  ): Promise<Result<PluginManifest>> {
    return this.inner.previewPluginEntry(entrySource, executionMode);
  }

  /** 安装可执行插件（ADR-054）：委托 inner（注册 + 持久化）。 */
  installPluginEntry(
    entrySource: string,
    executionMode: PluginExecutionMode,
  ): Promise<Result<PluginManifest>> {
    return this.inner.installPluginEntry(entrySource, executionMode);
  }

  // ---- 读写（按协议路由）----
  readRow(
    row: RegisterRow,
    route?: RequestRoute,
  ): Promise<Result<number | number[]>> {
    return this.activeProtocol === "tcp"
      ? this.tcp.readRow(row, route ?? this.fallbackRoute())
      : this.inner.readRow(row, route ?? this.fallbackRoute());
  }

  writeRow(
    row: RegisterRow,
    options?: { writeVerify?: ReadVerifySettings },
    route?: RequestRoute,
  ): Promise<Result<WriteOutcome>> {
    return this.activeProtocol === "tcp"
      ? this.tcp.writeRow(row, options, route ?? this.fallbackRoute())
      : this.inner.writeRow(row, options, route ?? this.fallbackRoute());
  }

  readAllRows(rows: BatchReadRow[], route?: RequestRoute): BatchReadHandle {
    return this.activeProtocol === "tcp"
      ? this.tcp.readAllRows(rows, undefined, route ?? this.fallbackRoute())
      : this.inner.readAllRows(rows, route ?? this.fallbackRoute());
  }

  // ---- 轮询 ----
  updatePollingTargets(
    rows: Array<{
      key: string;
      address: number;
      quantity?: number;
      route?: RequestRoute;
    }>,
  ): void {
    if (this.activeProtocol === "tcp") {
      this.tcp.updatePollingTargets(rows);
      return;
    }
    this.inner.updatePollingTargets(rows);
  }

  startPolling(): void {
    if (this.activeProtocol === "tcp") {
      this.tcp.startPolling();
      return;
    }
    this.inner.startPolling();
  }

  stopPolling(): void {
    if (this.activeProtocol === "tcp") {
      this.tcp.stopPolling();
      return;
    }
    this.inner.stopPolling();
  }

  subscribePollResult(
    listener: (
      key: string,
      address: number,
      result: Result<number | number[]>,
    ) => void,
  ): () => void {
    this.pollResultListeners.add(listener);
    return () => {
      this.pollResultListeners.delete(listener);
    };
  }

  // ---- TM 追踪 ----
  traceStart(
    key: string,
    address: number,
    speedMs: number,
    quantity?: number,
    route?: RequestRoute,
  ): void {
    if (this.activeProtocol === "tcp") {
      this.tcp.traceStart(
        key,
        address,
        speedMs,
        quantity,
        route ?? this.fallbackRoute(),
      );
      return;
    }
    this.inner.traceStart(
      key,
      address,
      speedMs,
      quantity,
      route ?? this.fallbackRoute(),
    );
  }

  traceStop(key: string): void {
    if (this.activeProtocol === "tcp") {
      this.tcp.traceStop(key);
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

  // ---- 日志与消息 ----
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

  // ---- 剪贴板（WebView 处于安全上下文，复用浏览器路径）----
  copyTextToClipboard(text: string): Promise<Result<void>> {
    return this.inner.copyTextToClipboard(text);
  }

  readTextFromClipboard(): Promise<Result<string | null>> {
    return this.inner.readTextFromClipboard();
  }

  // ---- 文件（Phase 4 接 Capacitor Filesystem + SAF/分享；Phase 1 能力错误）----
  async saveTextFile(_options: {
    suggestedName: string;
    content: string;
    mimeType?: string;
  }): Promise<Result<SaveTextFileResponse>> {
    return fail(
      createMamepError({
        code: "LOG_EXPORT_UNSUPPORTED",
        category: "capability",
        retryable: false,
        userMessageKey: "errors.workspaceExportUnsupported",
        technicalMessage: "android file export is not implemented in Phase 1",
      }),
    );
  }

  async openTextFile(_options?: {
    suggestedName?: string;
  }): Promise<Result<OpenTextFileResponse>> {
    return fail(
      createMamepError({
        code: "WORKSPACE_IMPORT_UNSUPPORTED",
        category: "capability",
        retryable: false,
        userMessageKey: "errors.workspaceImportUnsupported",
        technicalMessage: "android file import is not implemented in Phase 1",
      }),
    );
  }

  // ---- 插件运行时桥（Android 无宿主侧插件执行面 → 沿用浏览器能力错误语义）----
  pluginRuntimeLoad(payload: PluginRuntimeLoadPayload): Promise<Result<null>> {
    return this.inner.pluginRuntimeLoad(payload);
  }

  pluginRuntimeUnload(
    payload: PluginRuntimeUnloadPayload,
  ): Promise<Result<null>> {
    return this.inner.pluginRuntimeUnload(payload);
  }

  pluginRpc(payload: PluginRpcPayload): Promise<Result<unknown>> {
    return this.inner.pluginRpc(payload);
  }

  pluginContributionQuery(payload?: {
    pointId?: string;
  }): Promise<Result<PluginContributionQueryResponse>> {
    return this.inner.pluginContributionQuery(payload);
  }

  async dispose(): Promise<void> {
    this.connectionListeners.clear();
    this.commLogListeners.clear();
    this.messageListeners.clear();
    this.pollResultListeners.clear();
    this.traceListeners.clear();
    await this.tcp.dispose();
    await this.inner.dispose();
    this.activeProtocol = null;
    this.tcpProfile = null;
    this.tcpConnectionState = "disconnected";
    this.portLabel = null;
  }
}

/**
 * 平台宿主的串口面（enumerated 平台专用）。
 * 不在 `PlatformHost` 里是因为浏览器宿主没有枚举语义；用结构化判定而非 `instanceof`，
 * 使测试可以注入自定义宿主。
 */
interface AndroidSerialHostPort {
  listSerialPorts(): Promise<Result<SerialPortOption[]>>;
  selectSerialPort(
    portId: string | null,
  ): Promise<Result<SerialDeviceHandle | null>>;
}

function hasSerialApi(host: unknown): host is AndroidSerialHostPort {
  const record = host as Partial<AndroidSerialHostPort> | null;
  return (
    typeof record?.listSerialPorts === "function" &&
    typeof record?.selectSerialPort === "function"
  );
}

/** 随应用分发插件条目（与 BrowserAppHost 同类型，供 composition root 复用）。 */
export type AndroidBundledPluginEntry = {
  pluginId: string;
  manifest: PluginManifest;
  createRuntime: () => PluginRuntime | undefined;
};
