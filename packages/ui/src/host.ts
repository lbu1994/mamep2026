/**
 * UI 侧的 Host 接口：UI 只通过这些用例访问业务能力（docs/AGENTS.md §8.3）。
 * 实现由 apps/web 的 composition root 提供。
 */
import type {
  BrowserCompatibility,
  FlowControl,
  PlatformCapabilities,
  ReadVerifySettings,
  RegisterRow,
  Result,
  RtuConnectionProfile,
  TcpConnectionProfile,
  Workspace,
  WorkspaceRecoveryInfo,
} from "@mamep2026/domain";
import type {
  BatchReadHandle,
  BatchReadRow,
  CommunicationLogEvent,
  CommunicationSession,
  ConnectionState,
  WriteOutcome,
} from "@mamep2026/communication";
import type { SaveStatus } from "@mamep2026/workspace";
import type {
  PluginRegistry,
  PluginRemoteRuntime,
} from "@mamep2026/plugin-api";
import type {
  PluginContributionQueryResponse,
  PluginRpcPayload,
  PluginRuntimeLoadPayload,
  PluginRuntimeUnloadPayload,
  SerialDeviceHandle,
  SerialPortOption,
  OpenTextFileResponse,
  SaveTextFileResponse,
} from "@mamep2026/platform-api";
import type { ApplicationMessage } from "@mamep2026/logging";

export interface TraceSampleEvent {
  key: string;
  sequence: number;
  rawValue: number;
  timestamp: number;
}

export interface CommProperties {
  /** 连接协议：RTU 显示串口参数；TCP 显示 host/port/unitId（2026-08-23）。 */
  protocol: "rtu" | "tcp";
  portLabel: string | null;
  /** TCP Unit ID（仅 TCP 有意义；RTU 为 null）。 */
  unitId: number | null;
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: string;
  flowControl: FlowControl;
  timeoutMs: number;
  retryCount: number;
  rxDelayMs: number;
  connectionState: ConnectionState;
}

export interface AppHost {
  readonly capabilities: PlatformCapabilities;
  readonly isMockMode: boolean;
  readonly pluginRegistry: PluginRegistry;
  /** 应用版本号（根 package.json version，由平台侧 composition root 注入）。 */
  readonly appVersion: string;

  /**
   * 运行平台标识（侧边栏 footer 等按平台显示文案）：
   * "browser" 浏览器端 / "electron" Electron 端 / "vscode" VSCode 插件端。
   */
  readonly platform: "browser" | "electron" | "vscode";

  /**
   * 启动插件系统（2026-09-02 插件外部化）：装配后显式调用——首次启动一次性安装随包插件
   * （installed + 持久化），重启经 hydrate 恢复并重建同进程 runtime；随后恢复用户安装的
   * 可执行插件（远程运行时）。无存储端口时降级为内存注册。
   */
  startPlugins(): Promise<void>;
  /** 恢复已卸载的随应用分发插件（Plugin Manager「恢复」）。 */
  restoreBundledPlugin(pluginId: string): Promise<void>;
  /** 恢复全部已卸载的随应用分发插件（Plugin Manager「恢复全部」）。 */
  restoreAllBundledPlugins(): Promise<void>;

  loadWorkspace(): Promise<Result<Workspace>>;
  /** 清除全部持久化数据并返回全新默认工作区（§16.5.5 用户重置损坏工作区）。 */
  resetWorkspace(): Promise<Result<Workspace>>;
  scheduleSave(workspace: Workspace): void;
  /** 立即保存当前待写快照（应用关闭/页面隐藏前调用，ADR-049 崩溃后状态恢复）。 */
  flush(): Promise<Result<void>>;
  /** 最近一次加载的恢复元数据（ADR-049 恢复提示；null=无恢复相关信息）。 */
  getWorkspaceRecoveryInfo(): WorkspaceRecoveryInfo | null;
  getSaveStatus(): SaveStatus;
  subscribeSaveStatus(listener: (status: SaveStatus) => void): () => void;

  supportsWebSerial(): boolean;
  /**
   * 浏览器兼容性检测结果（PRD §8.3 / §15.7 / TECH_DESIGN §40.2）。
   * 浏览器端返回运行时检测结果（Web Serial 存在性 + 安全上下文）；
   * Electron/VSCode 返回 null（串口能力经能力矩阵声明，不走浏览器兼容性提示）。
   */
  readonly browserCompatibility: BrowserCompatibility | null;
  /**
   * 枚举可用串口（serialPorts === "enumerated" 时调用，如 Electron）：
   * 返回下拉框可展示的端口列表；不支持枚举的平台返回 fail（浏览器端不用该方法）。
   */
  enumerateSerialPorts(): Promise<Result<SerialPortOption[]>>;
  /**
   * 选择串口：
   * - 浏览器（browser-picker）：忽略参数，弹系统原生选择框；
   * - Electron（enumerated）：portId 指定要选的端口，null/空串 = 取消当前选择会话。
   */
  selectSerialPort(
    portId?: string | null,
  ): Promise<Result<SerialDeviceHandle | null>>;

  connect(
    profile: RtuConnectionProfile,
    handle: SerialDeviceHandle | null,
    options?: { protocol?: string },
  ): Promise<Result<void>>;
  /**
   * TCP 连接（2026-08-23 两端 TCP 接线）：profile 即连接参数（host/port/unitId/超时/重试），
   * 无串口句柄。仅 Electron/VSCode 支持；浏览器返回能力错误（UI 依能力矩阵不调用）。
   */
  connectTcp(profile: TcpConnectionProfile): Promise<Result<void>>;
  disconnect(): Promise<Result<void>>;
  /**
   * 当前通信会话（ADR-044 Phase F-2）：插件通信面（PluginCommunicationApi）经统一
   * 调度器访问会话；未连接 / 会话在远程宿主时返回 null（插件通信降级为能力错误）。
   */
  getSession(): CommunicationSession | null;
  /**
   * 创建插件隔离运行时（ADR-044 Phase F-2）：单文件 JS 插件 entry 在隔离线程
   * （Web Worker）加载执行；通信面按插件 id 动态绑定到当前会话（统一调度器）。
   */
  createPluginRemoteRuntime(entrySource: string): PluginRemoteRuntime;
  /**
   * 释放全部资源（页面卸载 / Webview 销毁 / StrictMode 重复挂载清理）：
   * 断开会话、退订所有外部事件源（如 bridge.onEvent）并清空本地订阅集合，
   * 保证重复挂载不产生重复订阅（事件重复投递的根因，2026-08-23）。
   */
  dispose(): Promise<void>;
  getConnectionState(): ConnectionState;
  getCommProperties(): CommProperties;
  /** 更新当前会话的从站地址（每表独立，2026-08-19）：对后续所有请求生效。 */
  setSlaveAddress(slave: number): void;
  /**
   * 更新活动表地址变换配置（2026-09-01，ADR-042 表级 Address Adjust）：
   * 对后续读/写请求生效（轮询地址在 Renderer 生成时按表应用，不经本端口）。
   * null=不调整；host 端会话（VSCode/Electron TCP）经 session-set-address-transform RPC。
   */
  setAddressTransform(
    config: {
      transformId: string;
      enabled: boolean;
    } | null,
  ): void;
  subscribeConnectionState(
    listener: (state: ConnectionState) => void,
  ): () => void;

  /** 单行读取（多寄存器行返回 values[]，ADR-030）。 */
  readRow(row: RegisterRow): Promise<Result<number | number[]>>;
  /**
   * 单行写（FC0x10）。options.writeVerify（2026-08-26）：每表写后回读配置，
   * 非 off 时写入后按配置（立即/延迟）FC03 回读，返回扩展的 WriteOutcome（§18.2）。
   */
  writeRow(
    row: RegisterRow,
    options?: { writeVerify?: ReadVerifySettings },
  ): Promise<Result<WriteOutcome>>;
  readAllRows(rows: BatchReadRow[]): BatchReadHandle;

  /** WP 轮询：传入当前启用轮询的有效行（多寄存器行携带 quantity，ADR-030）。 */
  updatePollingTargets(
    rows: Array<{ key: string; address: number; quantity?: number }>,
  ): void;
  startPolling(): void;
  stopPolling(): void;
  subscribePollResult(
    listener: (
      key: string,
      address: number,
      result: Result<number | number[]>,
    ) => void,
  ): () => void;

  traceStart(
    key: string,
    address: number,
    speedMs: number,
    quantity?: number,
  ): void;
  traceStop(key: string): void;
  subscribeTraceSample(
    listener: (sample: TraceSampleEvent) => void,
  ): () => void;

  subscribeCommLog(
    listener: (event: CommunicationLogEvent) => void,
  ): () => void;
  subscribeMessage(listener: (message: ApplicationMessage) => void): () => void;
  pushMessage(
    level: "info" | "warning" | "error",
    messageKey: string,
    detail?: string,
  ): void;

  /** 把文本写入系统剪贴板；无权限/非安全上下文时返回结构化错误。 */
  copyTextToClipboard(text: string): Promise<Result<void>>;
  /** 读取系统剪贴板文本；无内容返回 ok(null)。 */
  readTextFromClipboard(): Promise<Result<string | null>>;
  /**
   * 保存文本文件（2026-08-28 通信日志 CSV 导出）：
   * 浏览器触发 Blob 下载；桌面端弹保存对话框落盘（用户取消返回 ok({ saved: false })）。
   * CSV 序列化由 packages/logging 完成，本端口只负责平台侧落盘/下载。
   */
  saveTextFile(options: {
    suggestedName: string;
    content: string;
    mimeType?: string;
  }): Promise<Result<SaveTextFileResponse>>;
  /**
   * 打开文件对话框并读取 UTF-8 文本（2026-08-29 工作区导入）：
   * 桌面端（workspaceImport === "file"）弹系统打开对话框读取；用户取消返回 ok({ content: null })。
   * 浏览器（workspaceImport === "upload"）UI 走客户端文件选择（antd Upload），不调用本端口。
   */
  openTextFile(options?: {
    suggestedName?: string;
  }): Promise<Result<OpenTextFileResponse>>;

  /**
   * 插件运行时桥（2026-08-31，ADR-039，Phase A 契约就位）：
   * - pluginRuntimeLoad / pluginRuntimeUnload：请求宿主加载/卸载 Host 插件实例；
   * - pluginRpc：渲染 ↔ 宿主通用插件调用桥；
   * - pluginContributionQuery：查询宿主侧已装配贡献点。
   * Phase A 宿主侧（Electron/VSCode）返回 PLUGIN_RUNTIME_NOT_AVAILABLE 能力错误；
   * 浏览器无宿主桥，同样返回能力错误。运行时语义随 Phase F（隔离机制 ADR）补齐。
   */
  pluginRuntimeLoad(payload: PluginRuntimeLoadPayload): Promise<Result<null>>;
  pluginRuntimeUnload(
    payload: PluginRuntimeUnloadPayload,
  ): Promise<Result<null>>;
  pluginRpc(payload: PluginRpcPayload): Promise<Result<unknown>>;
  pluginContributionQuery(payload?: {
    pointId?: string;
  }): Promise<Result<PluginContributionQueryResponse>>;
}
