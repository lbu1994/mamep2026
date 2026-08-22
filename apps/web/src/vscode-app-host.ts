/**
 * VSCode Webview Renderer Host（docs/TECH_DESIGN.md §5.1.6、§6.3）。
 * 实现共享 UI 的 AppHost 契约。骨架阶段（2026-08-23）：串口/TCP/文件持久化未实现，
 * 能力矩阵 vscodeCapabilities 如实声明（modbusRtu:false、serialPorts:"unsupported" 等，
 * AGENTS.md §32 ㉒）。连接/读写/轮询/Trace/日志/工作区全部委托复用 BrowserAppHost
 * （含 IndexedDB 自动保存与会话恢复）；剪贴板与颜色主题走 VSCode 桥
 * （window.mamepHost，HostMessage v1 类型化 RPC）。
 */
import type {
  BatchReadHandle,
  BatchReadRow,
  CommunicationLogEvent,
  ConnectionState,
  WriteOutcome,
} from "@mamep2026/communication";
import type {
  PlatformCapabilities,
  RegisterRow,
  Result,
  RtuConnectionProfile,
  Workspace,
} from "@mamep2026/domain";
import type { ApplicationMessage } from "@mamep2026/logging";
import type {
  ColorThemeKind,
  MamepHostEvent,
  SerialDeviceHandle,
  SerialPortOption,
  VscodeHostApi,
} from "@mamep2026/platform-api";
import { vscodeCapabilities } from "@mamep2026/platform-api";
import type { PluginRegistry } from "@mamep2026/plugin-api";
import {
  BrowserPlatformHost,
  createIdbKeyValueStore,
  IndexedDBWorkspaceRepository,
} from "@mamep2026/platform-web";
import type { SaveStatus, WorkspaceRepositoryPort } from "@mamep2026/workspace";
import { useAppStore } from "@mamep2026/ui";
import type { AppHost, CommProperties, TraceSampleEvent } from "@mamep2026/ui";
import { BrowserAppHost } from "./AppHost";

/** VscodeAppHost 可注入依赖（测试用；生产走默认装配）。 */
export interface VscodeAppHostOptions {
  /** 工作区仓储（默认 IndexedDB；测试注入内存仓储）。 */
  repository?: WorkspaceRepositoryPort | undefined;
}

export class VscodeAppHost implements AppHost {
  readonly capabilities: PlatformCapabilities;
  readonly isMockMode = false;
  readonly pluginRegistry: PluginRegistry;
  readonly appVersion = __APP_VERSION__;

  private readonly bridge: VscodeHostApi;
  private readonly inner: BrowserAppHost;

  constructor(bridge: VscodeHostApi, options: VscodeAppHostOptions = {}) {
    this.bridge = bridge;
    // 骨架阶段无串口：platform host 不注入 serial（capabilities 声明 unsupported，UI 不发起连接）。
    this.inner = new BrowserAppHost({
      platform: new BrowserPlatformHost({}),
      repository:
        options.repository ??
        new IndexedDBWorkspaceRepository(createIdbKeyValueStore()),
      mockTransport: false,
    });
    this.capabilities = vscodeCapabilities;
    this.pluginRegistry = this.inner.pluginRegistry;
    // 主题：初始化查询 + 订阅宿主 color-theme-changed 事件，映射共享 store 的 antd 主题
    // （Host 与应用同生命周期，无需退订）。
    void this.applyColorThemeFromHost();
    bridge.onEvent((event: MamepHostEvent) => {
      if (event.kind === "color-theme-changed") {
        // 事件 payload 结构由 color-theme-changed kind 契约保证（Zod 已校验）。
        const { theme } = event.payload as { theme: ColorThemeKind };
        useAppStore.getState().setTheme(theme);
      }
    });
  }

  private async applyColorThemeFromHost(): Promise<void> {
    const result = await this.bridge.getColorTheme();
    if (result.ok) {
      useAppStore.getState().setTheme(result.value);
    }
  }

  // ---- 工作区（委托 inner：IndexedDB 自动保存与会话恢复，复用浏览器路径）----

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

  // ---- 串口（骨架未实现：委托 inner，能力矩阵已声明 unsupported，UI 不发起连接）----

  supportsWebSerial(): boolean {
    return this.inner.supportsWebSerial();
  }

  enumerateSerialPorts(): Promise<Result<SerialPortOption[]>> {
    return this.inner.enumerateSerialPorts();
  }

  selectSerialPort(
    portId?: string | null,
  ): Promise<Result<SerialDeviceHandle | null>> {
    return this.inner.selectSerialPort(portId);
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
    return this.inner.getCommProperties();
  }

  setSlaveAddress(slave: number): void {
    this.inner.setSlaveAddress(slave);
  }

  subscribeConnectionState(
    listener: (state: ConnectionState) => void,
  ): () => void {
    return this.inner.subscribeConnectionState(listener);
  }

  // ---- 寄存器读写 / 轮询 / Trace（全部委托 inner）----

  readRow(row: RegisterRow): Promise<Result<number>> {
    return this.inner.readRow(row);
  }

  writeRow(row: RegisterRow): Promise<Result<WriteOutcome>> {
    return this.inner.writeRow(row);
  }

  readAllRows(rows: BatchReadRow[]): BatchReadHandle {
    return this.inner.readAllRows(rows);
  }

  updatePollingTargets(rows: Array<{ key: string; address: number }>): void {
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

  // ---- 剪贴板（走 VSCode 桥：vscode.env.clipboard，宿主校验）----

  copyTextToClipboard(text: string): Promise<Result<void>> {
    return this.bridge.copyTextToClipboard(text);
  }

  readTextFromClipboard(): Promise<Result<string | null>> {
    return this.bridge.readTextFromClipboard();
  }
}
