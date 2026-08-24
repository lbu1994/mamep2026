/**
 * Electron Renderer Host（docs/TECH_DESIGN.md §5.1.6、§6.2）。
 * 实现共享 UI 的 AppHost 契约。MVP 串口（ADR-017，2026-08-21；2026-08-21 扩展为下拉框选择）：
 * 仍经 Web Serial API（Renderer navigator.serial），但主进程 select-serial-port 不再自动选
 * 第一个端口，而是把端口列表经 serial-ports-available 事件转发给本 Host，UI 以 antd Select
 * 下拉框展示；用户选择后经 preload 桥 selectSerialPort(portId) 回传主进程解析挂起请求，
 * 再 await requestPort() 得到所选端口对象。连接/读写/轮询/Trace/日志/工作区全部委托复用
 * BrowserAppHost（含 IndexedDB 自动保存与会话恢复）；剪贴板走 preload 白名单桥
 * （window.mamepHost）主进程真实实现。
 */
import type {
  BatchReadHandle,
  BatchReadRow,
  CommunicationLogEvent,
  ConnectionState,
  WriteOutcome,
} from "@mamep2026/communication";
import { createMamepError, fail, ok } from "@mamep2026/domain";
import type {
  PlatformCapabilities,
  RegisterRow,
  Result,
  RtuConnectionProfile,
  TcpConnectionProfile,
  Workspace,
} from "@mamep2026/domain";
import type { ApplicationMessage } from "@mamep2026/logging";
import type { ConnectionConfigFile } from "@mamep2026/connection-config";
import {
  commLogEventFromPayload,
  electronCapabilities,
  fromResultPayload,
  toRegisterRowPayload,
  toTcpConnectionProfilePayload,
  type AppMessagePayload,
  type CommLogEventPayload,
  type ConnectionConfigLoadResponse,
  type HostResultPayload,
  type MamepHostApi,
  type MamepHostEvent,
  type SerialDeviceHandle,
  type SerialPortOption,
  type TraceSamplePayload,
} from "@mamep2026/platform-api";
import type { PluginRegistry } from "@mamep2026/plugin-api";
import {
  BrowserPlatformHost,
  createIdbKeyValueStore,
  IndexedDBWorkspaceRepository,
  usbDeviceLabel,
  type Serial,
  type SerialPort,
  type WebSerialHandle,
} from "@mamep2026/platform-web";
import type { SaveStatus, WorkspaceRepositoryPort } from "@mamep2026/workspace";
import type { AppHost, CommProperties, TraceSampleEvent } from "@mamep2026/ui";
import { BrowserAppHost } from "./AppHost";

/** ElectronAppHost 可注入依赖（测试用；生产走默认装配）。 */
export interface ElectronAppHostOptions {
  /** Web Serial 对象（默认 navigator.serial；测试注入 fake）。 */
  serial?: Serial | undefined;
  /** 工作区仓储（默认 IndexedDB；测试注入内存仓储）。 */
  repository?: WorkspaceRepositoryPort | undefined;
}

export class ElectronAppHost implements AppHost {
  readonly capabilities: PlatformCapabilities;
  readonly isMockMode = false;
  readonly pluginRegistry: PluginRegistry;
  readonly appVersion = __APP_VERSION__;

  private readonly bridge: MamepHostApi;
  /** 主进程桥事件退订（dispose 时调用；StrictMode 重复挂载时保证旧 host 不再接收事件）。 */
  private readonly disposeBridgeEvents: () => void;
  private readonly platform: BrowserPlatformHost;
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

  // ---- 混合模式（2026-08-23 两端 TCP 接线）：RTU 本地（inner）/ TCP 主进程远程代理 ----
  /** 当前活动协议（RTU 复用浏览器 Web Serial 路径；TCP 走主进程远程会话）。 */
  private activeProtocol: "rtu" | "tcp" | null = null;
  /** TCP 连接配置本地镜像（通信属性摘要用）。 */
  private tcpProfile: TcpConnectionProfile | null = null;
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
    (key: string, address: number, result: Result<number>) => void
  >();
  private readonly traceListeners = new Set<(sample: TraceSampleEvent) => void>();

  constructor(bridge: MamepHostApi, options: ElectronAppHostOptions = {}) {
    this.bridge = bridge;
    this.serial = options.serial ?? navigator.serial;
    // 串口（enumerated）：Renderer 的 Chromium 即支持 navigator.serial，连接/读写仍复用
    // 浏览器 Web Serial 路径；仅「选择串口」改为下拉框枚举（主进程 select-serial-port
    // 转发端口列表 → serial-ports-available 事件 → 用户选择 → selectSerialPort 回传）。
    this.platform = new BrowserPlatformHost({ serial: this.serial });
    this.inner = new BrowserAppHost({
      platform: this.platform,
      repository:
        options.repository ??
        new IndexedDBWorkspaceRepository(createIdbKeyValueStore()),
      mockTransport: false,
    });
    this.capabilities = electronCapabilities;
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
    this.inner.subscribePollResult((key, address, result) => {
      for (const listener of this.pollResultListeners) listener(key, address, result);
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
        const { key, address, result } = event.payload as {
          key: string;
          address: number;
          result: HostResultPayload;
        };
        const pollResult = fromResultPayload(result);
        for (const listener of this.pollResultListeners)
          listener(key, address, pollResult);
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

  resetWorkspace(): Promise<Result<Workspace>> {
    return this.inner.resetWorkspace();
  }

  scheduleSave(workspace: Workspace): void {
    this.inner.scheduleSave(workspace);
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
    return this.platform.supportsWebSerial;
  }

  /** 加载连接对象配置文件（ADR-023）：主进程读文件系统（经 preload 白名单桥）。 */
  loadConnectionConfig(): Promise<Result<ConnectionConfigLoadResponse>> {
    return this.bridge.loadConnectionConfig();
  }

  /** 桌面端由宿主文件读取配置，不经 UI 导入：返回能力错误。 */
  importConnectionConfigText(): Promise<Result<ConnectionConfigFile>> {
    return Promise.resolve(
      fail(
        createMamepError({
          code: "CONNECTION_CONFIG_IMPORT_UNSUPPORTED",
          category: "capability",
          userMessageKey: "errors.connectionConfigImportUnsupported",
          technicalMessage:
            "connection config import is not supported on the Electron host (load from config file)",
        }),
      ),
    );
  }

  async connect(
    profile: RtuConnectionProfile,
    handle: SerialDeviceHandle | null,
  ): Promise<Result<void>> {
    const result = await this.inner.connect(profile, handle);
    if (result.ok) this.activeProtocol = "rtu";
    return result;
  }

  /**
   * TCP 连接（2026-08-23 两端 TCP 接线）：会话承载在主进程（ElectronSessionHost），
   * 本方法经 bridge.sessionTcpConnect 远程代理；连接后的读写/轮询/Trace 亦走主进程。
   */
  async connectTcp(profile: TcpConnectionProfile): Promise<Result<void>> {
    const result = await this.bridge
      .sessionTcpConnect({ profile: toTcpConnectionProfilePayload(profile) })
      .then((r) => {
        if (!r.ok) return r;
        this.tcpProfile = profile;
        this.portLabel = `${profile.host}:${profile.port}`;
        this.tcpConnectionState = "connected";
        this.activeProtocol = "tcp";
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
        return ok(undefined);
      }
      return result;
    }
    return this.inner.disconnect();
  }

  /**
   * 释放全部资源（StrictMode 重复挂载 / 卸载清理）：退订主进程桥事件、清空本地订阅
   * 集合、取消挂起选择会话并 dispose inner。修复事件重复投递（comm-log 一条变两条）
   * 的根因（2026-08-23）。
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
    this.tcpProfile = null;
    this.tcpConnectionState = "disconnected";
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
        portLabel: this.portLabel,
        unitId: profile?.unitId ?? 0,
        baudRate: 0,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "off",
        timeoutMs: profile?.requestTimeoutMs ?? 1000,
        retryCount: profile?.retryCount ?? 1,
        rxDelayMs: profile?.interRequestDelayMs ?? 50,
        addressAdjust: "off",
        connectionState: this.tcpConnectionState,
      };
    }
    const props = this.inner.getCommProperties();
    // 枚举路径的已选端口标签由本 Host 记录（inner 仅在浏览器路径自行记录）。
    return { ...props, protocol: "rtu", portLabel: this.portLabel ?? props.portLabel };
  }

  /** RTU 从站地址（TCP Unit ID 连接时确定，会话内不修改，2026-08-23）。 */
  setSlaveAddress(slave: number): void {
    if (this.activeProtocol !== "tcp") this.inner.setSlaveAddress(slave);
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

  readRow(row: RegisterRow): Promise<Result<number>> {
    if (this.activeProtocol === "tcp") {
      return this.bridge.sessionReadRow(toRegisterRowPayload(row));
    }
    return this.inner.readRow(row);
  }

  writeRow(row: RegisterRow): Promise<Result<WriteOutcome>> {
    if (this.activeProtocol === "tcp") {
      return this.bridge.sessionWriteRow(toRegisterRowPayload(row));
    }
    return this.inner.writeRow(row);
  }

  readAllRows(rows: BatchReadRow[]): BatchReadHandle {
    if (this.activeProtocol === "tcp") {
      const handle = this.bridge.sessionBatchRead(
        rows.map((r) => ({ key: r.key, address: r.address })),
      );
      return {
        promise: handle.then((result) =>
          result.ok
            ? { ok: true as const, value: result.value.summary }
            : result,
        ),
        cancel: () => undefined,
      };
    }
    return this.inner.readAllRows(rows);
  }

  // ---- 轮询 / Trace / 日志：RTU 复用浏览器路径（inner）/ TCP 走主进程远程会话 ----

  updatePollingTargets(
    rows: Array<{ key: string; address: number }>,
  ): void {
    if (this.activeProtocol === "tcp") {
      void this.bridge.sessionUpdatePollingTargets(rows);
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

  subscribePollResult(
    listener: (key: string, address: number, result: Result<number>) => void,
  ): () => void {
    this.pollResultListeners.add(listener);
    return () => {
      this.pollResultListeners.delete(listener);
    };
  }

  traceStart(key: string, address: number, speedMs: number): void {
    if (this.activeProtocol === "tcp") {
      void this.bridge.sessionTraceStart(key, address, speedMs);
      return;
    }
    this.inner.traceStart(key, address, speedMs);
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
}

