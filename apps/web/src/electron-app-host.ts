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
import { createMamepError, fail } from "@mamep2026/domain";
import type {
  PlatformCapabilities,
  RegisterRow,
  Result,
  RtuConnectionProfile,
  Workspace,
} from "@mamep2026/domain";
import type { ApplicationMessage } from "@mamep2026/logging";
import type {
  MamepHostApi,
  MamepHostEvent,
  SerialDeviceHandle,
  SerialPortOption,
} from "@mamep2026/platform-api";
import { electronCapabilities } from "@mamep2026/platform-api";
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
    // 订阅主进程事件：serial-ports-available 携带可用端口列表，交给挂起的枚举。
    // （Host 与应用同生命周期，无需退订；不保存退订函数。）
    bridge.onEvent((event: MamepHostEvent) => {
      if (event.kind === "serial-ports-available") {
        const { ports } = event.payload as { ports: SerialPortOption[] };
        this.pendingPortsResolve?.(ports);
        this.pendingPortsResolve = null;
      }
    });
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

  connect(
    profile: RtuConnectionProfile,
    handle: SerialDeviceHandle | null,
  ): Promise<Result<void>> {
    return this.inner.connect(profile, handle);
  }

  disconnect(): Promise<Result<void>> {
    return this.inner.disconnect();
  }

  getConnectionState(): ConnectionState {
    return this.inner.getConnectionState();
  }

  getCommProperties(): CommProperties {
    const props = this.inner.getCommProperties();
    // 枚举路径的已选端口标签由本 Host 记录（inner 仅在浏览器路径自行记录）。
    return { ...props, portLabel: this.portLabel ?? props.portLabel };
  }

  setSlaveAddress(slave: number): void {
    this.inner.setSlaveAddress(slave);
  }

  subscribeConnectionState(
    listener: (state: ConnectionState) => void,
  ): () => void {
    return this.inner.subscribeConnectionState(listener);
  }

  // ---- 设备请求（统一调度器，复用浏览器路径）----

  readRow(row: RegisterRow): Promise<Result<number>> {
    return this.inner.readRow(row);
  }

  writeRow(row: RegisterRow): Promise<Result<WriteOutcome>> {
    return this.inner.writeRow(row);
  }

  readAllRows(rows: BatchReadRow[]): BatchReadHandle {
    return this.inner.readAllRows(rows);
  }

  // ---- 轮询 / Trace / 日志（复用浏览器路径）----

  updatePollingTargets(
    rows: Array<{ key: string; address: number }>,
  ): void {
    this.inner.updatePollingTargets(rows);
  }

  startPolling(): void {
    this.inner.startPolling();
  }

  stopPolling(): void {
    this.inner.stopPolling();
  }

  subscribePollResult(
    listener: (key: string, address: number, result: Result<number>) => void,
  ): () => void {
    return this.inner.subscribePollResult(listener);
  }

  traceStart(key: string, address: number, speedMs: number): void {
    this.inner.traceStart(key, address, speedMs);
  }

  traceStop(key: string): void {
    this.inner.traceStop(key);
  }

  subscribeTraceSample(
    listener: (sample: TraceSampleEvent) => void,
  ): () => void {
    return this.inner.subscribeTraceSample(listener);
  }

  subscribeCommLog(
    listener: (event: CommunicationLogEvent) => void,
  ): () => void {
    return this.inner.subscribeCommLog(listener);
  }

  subscribeMessage(
    listener: (message: ApplicationMessage) => void,
  ): () => void {
    return this.inner.subscribeMessage(listener);
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

