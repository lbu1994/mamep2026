/**
 * VSCode Webview Renderer Host（docs/TECH_DESIGN.md §5.1.6、§6.3、§22.2）。
 * 实现共享 UI 的 AppHost 契约。VSCode RTU 接线（2026-08-23）：通信在 Extension Host 执行
 * （TECH_DESIGN §28.3），本类作为「远程会话代理」——connect/读/写/批量/轮询/Trace 全部
 * 经 HostMessage v1 类型化 RPC（window.mamepHost，VscodeHostApi）委托 Extension Host；
 * 工作区持久化（IndexedDB）复用 BrowserAppHost 路径；剪贴板与颜色主题走 VSCode 桥。
 * 能力矩阵 vscodeCapabilities 如实声明（modbusRtu:true、serialPorts:"enumerated"）。
 */
import type {
  BatchReadHandle,
  BatchReadRow,
  BatchReadSummary,
  CommunicationLogEvent,
  CommunicationSession,
  ConnectionState,
  WriteOutcome,
} from "@mamep2026/communication";
import type {
  PlatformCapabilities,
  ReadVerifySettings,
  RegisterRow,
  Result,
  RtuConnectionProfile,
  TcpConnectionProfile,
  Workspace,
} from "@mamep2026/domain";
import { createMamepError, fail, ok } from "@mamep2026/domain";
import type { ApplicationMessage } from "@mamep2026/logging";
import {
  commLogEventFromPayload,
  createBatchId,
  fromResultPayload,
  toReadVerifySettingsPayload,
  toRegisterRowPayload,
  toRtuConnectionProfilePayload,
  toTcpConnectionProfilePayload,
  vscodeCapabilities,
  type AppMessagePayload,
  type ColorThemeKind,
  type CommLogEventPayload,
  type HostResultPayload,
  type MamepHostEvent,
  type OpenTextFileResponse,
  type PluginContributionQueryResponse,
  type PluginRpcPayload,
  type PluginRuntimeLoadPayload,
  type PluginRuntimeUnloadPayload,
  type SaveTextFileResponse,
  type SerialDeviceHandle,
  type SerialPortOption,
  type TraceSamplePayload,
  type VscodeHostApi,
} from "@mamep2026/platform-api";
import type {
  PluginRegistry,
  PluginStorePort,
} from "@mamep2026/plugin-api";
import { createUnavailableCommunicationApi } from "@mamep2026/plugin-api";
import {
  buildVscodeTheme,
  readVscodeCssVars,
  type CssVarSource,
} from "@mamep2026/ui-theme";
import {
  BrowserPlatformHost,
  createIdbKeyValueStore,
  createWebPluginRemoteRuntime,
  IndexedDBWorkspaceRepository,
} from "@mamep2026/platform-web";
import type { SaveStatus, WorkspaceRepositoryPort } from "@mamep2026/workspace";
import { useAppStore } from "@mamep2026/ui";
import type { AppHost, CommProperties, TraceSampleEvent } from "@mamep2026/ui";
import { BrowserAppHost } from "./AppHost";
import { BridgePluginStore } from "./bridge-plugin-store";

/** VscodeAppHost 可注入依赖（测试用；生产走默认装配）。 */
export interface VscodeAppHostOptions {
  /** 工作区仓储（默认 IndexedDB；测试注入内存仓储）。 */
  repository?: WorkspaceRepositoryPort | undefined;
  /** 插件存储（默认 BridgePluginStore 经 vscode-bridge；测试注入内存仓储）。 */
  pluginStore?: PluginStorePort | undefined;
  /**
   * 主题 CSS 变量读取源（默认 getComputedStyle(document.documentElement) 惰性委托；
   * 测试注入 fake，避免 node 环境触碰 DOM）。
   */
  cssVarSource?: CssVarSource | undefined;
  /**
   * 帧调度（默认 requestAnimationFrame，测试注入同步执行）。用于主题事件后延迟重读
   * CSS 变量：生产 Webview 中 color-theme-changed 可能先于变量更新到达。
   */
  scheduleFrame?: (cb: () => void) => void;
}

/** 默认帧调度：requestAnimationFrame，无则回退 setTimeout（测试 node 环境不触发）。 */
function defaultScheduleFrame(cb: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => cb());
  } else {
    setTimeout(cb, 0);
  }
}

/** 从枚举结果中取端口显示标签（未匹配时回退端口 id）。 */
function portLabelOf(ports: SerialPortOption[], portId: string): string {
  return ports.find((p) => p.portId === portId)?.label ?? portId;
}

export class VscodeAppHost implements AppHost {
  readonly capabilities: PlatformCapabilities;
  readonly isMockMode = false;
  readonly pluginRegistry: PluginRegistry;
  readonly appVersion = __APP_VERSION__;

  private readonly bridge: VscodeHostApi;
  /** 桥事件退订（dispose 时调用；StrictMode 重复挂载时保证旧 host 不再接收事件）。 */
  private readonly disposeBridgeEvents: () => void;
  /** 工作区持久化复用浏览器路径（IndexedDB 自动保存与会话恢复）。 */
  private readonly inner: BrowserAppHost;

  /** 主题 CSS 变量读取源（惰性委托 getComputedStyle；测试注入 fake）。 */
  private readonly cssVarSource: CssVarSource;
  /** 帧调度（主题事件后延迟重读 CSS 变量）。 */
  private readonly scheduleFrame: (cb: () => void) => void;

  // 远程会话本地镜像（RPC 往返前的同步读取缓存）。
  private connectionState: ConnectionState = "disconnected";
  private currentProfile: RtuConnectionProfile | TcpConnectionProfile | null =
    null;
  private currentSlaveAddress = 1;
  private portLabel: string | null = null;
  private lastEnumeratedPorts: SerialPortOption[] = [];

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
    (
      key: string,
      address: number,
      result: Result<number | number[]>,
    ) => void
  >();
  private readonly traceListeners = new Set<
    (sample: TraceSampleEvent) => void
  >();

  constructor(bridge: VscodeHostApi, options: VscodeAppHostOptions = {}) {
    this.bridge = bridge;
    // 工作区/剪贴板/插件注册表复用浏览器路径；通信不走 inner（经 RPC 到 Extension Host）。
    this.inner = new BrowserAppHost({
      platform: new BrowserPlatformHost({}),
      repository:
        options.repository ??
        new IndexedDBWorkspaceRepository(createIdbKeyValueStore()),
      mockTransport: false,
      // 插件持久化（2026-08-30，ADR-038）：Extension Host globalState 经 vscode-bridge 薄桥。
      pluginStore: options.pluginStore ?? new BridgePluginStore(bridge),
    });
    this.capabilities = vscodeCapabilities;
    this.pluginRegistry = this.inner.pluginRegistry;
    this.cssVarSource =
      options.cssVarSource ??
      // 惰性委托：构造时不触碰 DOM（测试 node 环境安全），读取时才访问 document。
      {
        getPropertyValue: (name) =>
          getComputedStyle(document.documentElement).getPropertyValue(name),
      };
    this.scheduleFrame = options.scheduleFrame ?? defaultScheduleFrame;
    // 主题：初始化查询 + 订阅宿主 color-theme-changed 事件，映射共享 store 的 antd 主题
    // （完整令牌映射 buildVscodeTheme，ADR-027）；Host 与应用同生命周期，无需退订。
    void this.applyColorThemeFromHost();
    this.scheduleApplyHostTheme();
    // 桥事件订阅：dispose 时退订（StrictMode 双挂载下避免旧 host 残留订阅重复投递）。
    this.disposeBridgeEvents = bridge.onEvent((event: MamepHostEvent) => {
      this.handleHostEvent(event);
    });
  }

  /** 宿主事件分发：会话事件 → 本地缓存 + 订阅者（payload 形状由 kind 契约保证，Zod 已校验）。 */
  private handleHostEvent(event: MamepHostEvent): void {
    switch (event.kind) {
      case "color-theme-changed": {
        const { theme } = event.payload as { theme: ColorThemeKind };
        useAppStore.getState().setTheme(theme);
        // 主题变化后重读 CSS 变量并重建完整令牌（生产变量更新可能晚于事件，延迟一帧）。
        this.scheduleApplyHostTheme();
        break;
      }
      case "connection-state": {
        const { state } = event.payload as { state: ConnectionState };
        this.connectionState = state;
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
      case "serial-ports-available":
        // VSCode 枚举走请求-响应（serial-enumerate），不使用本事件。
        break;
    }
  }

  private async applyColorThemeFromHost(): Promise<void> {
    const result = await this.bridge.getColorTheme();
    if (result.ok) {
      useAppStore.getState().setTheme(result.value);
      // getColorTheme 就绪后再装配一次完整令牌（此时 store.theme 已反映宿主主题）。
      this.scheduleApplyHostTheme();
    }
  }

  /**
   * 装配完整主题令牌：立即读一次 + 下一帧再读一次。
   * - 生产：color-theme-changed 先于 CSS 变量更新到达时，第二帧读到新值；
   * - dev：主 frame 主题颜色中继（postMessage）可能晚于本方法首读，第二帧兜底。
   * 幂等：同值 setThemeConfig 无可见变化。
   */
  private scheduleApplyHostTheme(): void {
    this.applyHostTheme();
    this.scheduleFrame(() => this.applyHostTheme());
  }

  private applyHostTheme(): void {
    const colors = readVscodeCssVars(this.cssVarSource);
    const dark = useAppStore.getState().theme === "dark";
    useAppStore.getState().setThemeConfig(buildVscodeTheme(colors, dark));
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

  // ---- 串口（enumerated 下拉路径：serial-enumerate 枚举 + 本地选择句柄）----

  supportsWebSerial(): boolean {
    // VSCode Webview 无 navigator.serial；串口选择走 enumerated 下拉路径。
    return false;
  }

  async enumerateSerialPorts(): Promise<Result<SerialPortOption[]>> {
    const result = await this.bridge.enumerateSerialPorts();
    if (result.ok) {
      this.lastEnumeratedPorts = result.value;
    }
    return result;
  }

  async selectSerialPort(
    portId?: string | null,
  ): Promise<Result<SerialDeviceHandle | null>> {
    // VSCode：选择结果本地暂存，实际打开在 session-connect（Extension Host openSerialTransport）。
    if (portId === null || portId === undefined || portId === "") {
      return ok(null);
    }
    return ok({ id: portId, label: portLabelOf(this.lastEnumeratedPorts, portId) });
  }

  connect(
    profile: RtuConnectionProfile,
    handle: SerialDeviceHandle | null,
    options?: { protocol?: string },
  ): Promise<Result<void>> {
    if (handle === null) {
      return Promise.resolve(
        fail(
          createMamepError({
            code: "SERIAL_DEVICE_NOT_SELECTED",
            category: "validation",
            userMessageKey: "errors.selectDeviceFirst",
            technicalMessage: "no serial device selected",
          }),
        ),
      );
    }
    return this.bridge
      .sessionConnect({
        portId: handle.id,
        profile: toRtuConnectionProfilePayload(profile),
        slaveAddress: this.currentSlaveAddress,
        // ADR-043 E-6：codec 协议（基础表/安川）透传 Extension Host；缺省 rtu。
        ...(options?.protocol !== undefined && options.protocol !== "rtu"
          ? { protocol: options.protocol }
          : {}),
      })
      .then((result) => {
        if (!result.ok) return result;
        this.currentProfile = profile;
        this.portLabel = handle.label;
        this.connectionState = "connected";
        return ok(undefined);
      });
  }

  /** TCP 连接（session-tcp-connect）：profile 即连接参数，无串口句柄。 */
  connectTcp(profile: TcpConnectionProfile): Promise<Result<void>> {
    return this.bridge
      .sessionTcpConnect({ profile: toTcpConnectionProfilePayload(profile) })
      .then((result) => {
        if (!result.ok) return result;
        this.currentProfile = profile;
        this.portLabel = `${profile.host}:${profile.port}`;
        this.connectionState = "connected";
        return ok(undefined);
      });
  }

  disconnect(): Promise<Result<void>> {
    return this.bridge.sessionDisconnect().then((result) => {
      if (!result.ok) return result;
      this.connectionState = "disconnected";
      return ok(undefined);
    });
  }

  /**
   * 释放全部资源（StrictMode 重复挂载 / Webview 卸载清理）：退订桥事件、清空本地订阅
   * 集合、断开会话并 dispose inner。修复「一次读取在 Comm Log 里收发各两次、从站只
   * 收到一次」的重复投递根因（2026-08-23）。
   */
  async dispose(): Promise<void> {
    this.disposeBridgeEvents();
    this.connectionListeners.clear();
    this.commLogListeners.clear();
    this.messageListeners.clear();
    this.pollResultListeners.clear();
    this.traceListeners.clear();
    await this.inner.dispose();
    this.connectionState = "disconnected";
    this.currentProfile = null;
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /** 当前会话（ADR-044 Phase F-2）：VSCode 会话在 Extension Host，无本地会话 → null。 */
  getSession(): CommunicationSession | null {
    return null;
  }

  /** 插件隔离运行时（ADR-044 Phase F-2）：Webview 内 Web Worker 加载 entry。 */
  createPluginRemoteRuntime(entrySource: string) {
    return createWebPluginRemoteRuntime(entrySource, () =>
      createUnavailableCommunicationApi(),
    );
  }

  getCommProperties(): CommProperties {
    const profile = this.currentProfile;
    if (profile !== null && profile.protocol === "tcp") {
      // TCP 摘要（2026-08-23）：RTU 专属字段置默认；BottomPanel 按 protocol 渲染 TCP 字段。
      return {
        protocol: "tcp",
        portLabel: this.portLabel,
        unitId: profile.unitId,
        baudRate: 0,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "off",
        timeoutMs: profile.requestTimeoutMs,
        retryCount: profile.retryCount,
        rxDelayMs: profile.interRequestDelayMs,
        connectionState: this.connectionState,
      };
    }
    const rtu = profile as RtuConnectionProfile | null;
    return {
      protocol: "rtu",
      portLabel: this.portLabel,
      unitId: null,
      baudRate: rtu?.baudRate ?? 9600,
      dataBits: rtu?.dataBits ?? 8,
      stopBits: rtu?.stopBits ?? 1,
      parity: rtu?.parity ?? "none",
      flowControl: rtu?.flowControl ?? "off",
      timeoutMs: rtu?.requestTimeoutMs ?? 1000,
      retryCount: rtu?.retryCount ?? 1,
      rxDelayMs: rtu?.interRequestDelayMs ?? 50,
      connectionState: this.connectionState,
    };
  }

  /**
   * 从站地址 / TCP Unit ID 会话内动态修改（2026-08-25，ADR-022 已知限制打通）：
   * 渲染端按活动协议路由——RTU 走 session-set-slave-address，TCP 走 session-set-unit-id。
   */
  setSlaveAddress(slave: number): void {
    this.currentSlaveAddress = slave;
    if (this.currentProfile?.protocol === "tcp") {
      void this.bridge.sessionSetUnitId(slave);
    } else {
      void this.bridge.sessionSetSlaveAddress(slave);
    }
  }

  /** 更新活动表地址变换配置（ADR-042）：VSCode 会话在 Extension Host，经 session-set-address-transform RPC。 */
  setAddressTransform(config: {
    transformId: string;
    enabled: boolean;
  } | null): void {
    // TCP 无地址变换（恒不调整）：仍同步 null 使宿主复位。
    if (config === null) {
      void this.bridge.sessionSetAddressTransform({
        transformId: "builtin.address-adjust",
        enabled: false,
      });
    } else {
      void this.bridge.sessionSetAddressTransform(config);
    }
  }

  // ---- 寄存器读写 / 轮询 / Trace（远程会话 RPC）----

  readRow(row: RegisterRow): Promise<Result<number | number[]>> {
    return this.bridge.sessionReadRow(toRegisterRowPayload(row));
  }

  writeRow(
    row: RegisterRow,
    options?: { writeVerify?: ReadVerifySettings },
  ): Promise<Result<WriteOutcome>> {
    return this.bridge.sessionWriteRow(
      toRegisterRowPayload(row),
      options?.writeVerify !== undefined
        ? toReadVerifySettingsPayload(options.writeVerify)
        : undefined,
    );
  }

  readAllRows(rows: BatchReadRow[]): BatchReadHandle {
    // 远程代理：batchId 由渲染端生成（ADR-025），取消经 session-batch-cancel RPC 关联宿主批任务。
    const batchId = createBatchId();
    // 单次往返：行结果经 poll-result 事件流推送，响应只带汇总。
    let resolvePromise: (result: Result<BatchReadSummary>) => void = () => {};
    const promise = new Promise<Result<BatchReadSummary>>((resolve) => {
      resolvePromise = resolve;
    });
    void this.bridge.sessionBatchRead(batchId, rows).then((result) => {
      if (result.ok) {
        resolvePromise(ok(result.value.summary));
      } else {
        resolvePromise(result);
      }
    });
    return {
      promise,
      // 远程批任务取消（ADR-025）：经 session-batch-cancel RPC 通知宿主；幂等、异常安全。
      cancel: () => {
        void this.bridge.sessionBatchCancel(batchId);
      },
    };
  }

  updatePollingTargets(
    rows: Array<{ key: string; address: number; quantity?: number }>,
  ): void {
    void this.bridge.sessionUpdatePollingTargets(rows);
  }

  startPolling(): void {
    void this.bridge.sessionPollingStart();
  }

  stopPolling(): void {
    void this.bridge.sessionPollingStop();
  }

  traceStart(key: string, address: number, speedMs: number, quantity = 1): void {
    void this.bridge.sessionTraceStart(key, address, speedMs, quantity);
  }

  traceStop(key: string): void {
    void this.bridge.sessionTraceStop(key);
  }

  subscribeConnectionState(
    listener: (state: ConnectionState) => void,
  ): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  subscribePollResult(
    listener: (
      key: string,
      address: number,
      result: Result<number | number[]>,
    ) => void,
  ): () => void {
    this.pollResultListeners.add(listener);
    return () => this.pollResultListeners.delete(listener);
  }

  subscribeTraceSample(
    listener: (sample: TraceSampleEvent) => void,
  ): () => void {
    this.traceListeners.add(listener);
    return () => this.traceListeners.delete(listener);
  }

  subscribeCommLog(
    listener: (event: CommunicationLogEvent) => void,
  ): () => void {
    this.commLogListeners.add(listener);
    return () => this.commLogListeners.delete(listener);
  }

  subscribeMessage(
    listener: (message: ApplicationMessage) => void,
  ): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  pushMessage(
    level: "info" | "warning" | "error",
    messageKey: string,
    detail?: string,
  ): void {
    const message: ApplicationMessage = {
      timestamp: Date.now(),
      level,
      messageKey,
      detail: detail ?? null,
    };
    for (const listener of this.messageListeners) listener(message);
  }

  // ---- 剪贴板（走 VSCode 桥：vscode.env.clipboard，宿主校验）----

  copyTextToClipboard(text: string): Promise<Result<void>> {
    return this.bridge.copyTextToClipboard(text);
  }

  readTextFromClipboard(): Promise<Result<string | null>> {
    return this.bridge.readTextFromClipboard();
  }

  // ---- 通信日志 CSV 导出（2026-08-28，PRD §8.3 P1）：Extension Host 保存对话框 + workspace.fs 落盘 ----

  saveTextFile(options: {
    suggestedName: string;
    content: string;
    mimeType?: string;
  }): Promise<Result<SaveTextFileResponse>> {
    return this.bridge.saveTextFile(options);
  }

  // ---- 工作区导入（2026-08-29，PRD §8.3 P1）：Extension Host 打开对话框 + workspace.fs 读取 ----

  openTextFile(options?: {
    suggestedName?: string;
  }): Promise<Result<OpenTextFileResponse>> {
    return this.bridge.openTextFile(options);
  }

  // ---- 插件运行时桥（2026-08-31，ADR-039）：Extension Host 返回能力错误（Phase A），委托桥契约就位 ----

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
