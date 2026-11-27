/**
 * UI 侧 Host 子契约。
 *
 * 每个平台只声明它实际承担的职责；`AppHost` 通过交叉类型组合这些窄契约。
 * 新能力应优先加入对应子契约或新增独立子契约，避免扩散到无关平台 Host。
 */
import type {
  BrowserCompatibility,
  FlowControl,
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
} from "@mamep2026/domain";
import type {
  TraceIdentity,
  BatchReadHandle,
  BatchReadRow,
  CommunicationLogEvent,
  CommunicationSession,
  ConnectionState,
  WriteOutcome,
} from "@mamep2026/communication";
import type { SaveStatus } from "@mamep2026/workspace";
import type {
  PluginExecutionMode,
  PluginManifest,
  PluginRegistry,
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

export type TraceSampleEvent = import("@mamep2026/communication").TraceSample;

export interface CommProperties {
  /** 连接协议：RTU 显示串口参数；TCP 显示 host/port/unitId。 */
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
  connectionState: ConnectionState;
}

/** 与平台业务无关的 Host 身份和能力信息。 */
export interface HostIdentity {
  readonly capabilities: PlatformCapabilities;
  readonly isMockMode: boolean;
  /** 应用版本号（根 package.json version，由平台侧 composition root 注入）。 */
  readonly appVersion: string;
  /**
   * 运行平台标识（侧边栏 footer 等按平台显示文案）：
   * "browser" 浏览器端 / "electron" Electron 端 / "vscode" VSCode 插件端 / "android" Android（Capacitor）。
   */
  readonly platform: "browser" | "electron" | "vscode" | "android";
}

/** 工作区加载、恢复和自动保存。 */
export interface WorkspaceHost {
  /** Restore a backup only after the user confirms its preview. */
  recoverWorkspace?(): Promise<Result<Workspace>>;
  /** Export preserved source data and provenance without workspace parsing. */
  exportWorkspaceRecovery?(): Promise<Result<string>>;
  loadWorkspace(): Promise<Result<Workspace>>;
  /** 清除全部持久化数据并返回全新默认工作区（§16.5.5 用户重置损坏工作区）。 */
  resetWorkspace(): Promise<Result<Workspace>>;
  scheduleSave(workspace: Workspace): void;
  /** 立即保存当前待写快照（应用关闭/页面隐藏前调用崩溃后状态恢复）。 */
  flush(): Promise<Result<void>>;
  /** 最近一次加载的恢复元数据（恢复提示；null=无恢复相关信息）。 */
  getWorkspaceRecoveryInfo(): WorkspaceRecoveryInfo | null;
  getSaveStatus(): SaveStatus;
  subscribeSaveStatus(listener: (status: SaveStatus) => void): () => void;
}

/** 串口/TCP 会话、地址状态和寄存器请求。 */
export interface CommunicationHost {
  supportsWebSerial(): boolean;
  /**
   * 浏览器兼容性检测结果（PRD §8.3 / §15.7 / TECH_DESIGN §40.2）。
   * 浏览器端返回运行时检测结果（Web Serial 存在性 + 安全上下文）；
   * Electron/VSCode/Android 返回 null（串口能力经能力矩阵声明，不走浏览器兼容性提示）。
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
   * TCP 连接：profile 即连接参数（host/port/unitId/超时/重试），无串口句柄。
   * 浏览器返回能力错误（UI 依能力矩阵不调用）。
   */
  connectTcp(profile: TcpConnectionProfile): Promise<Result<void>>;
  disconnect(): Promise<Result<void>>;
  /**
   * 当前通信会话：插件通信面经统一调度器访问；
   * 未连接或会话在远程宿主时返回 null。
   */
  getSession(): CommunicationSession | null;
  getConnectionState(): ConnectionState;
  getCommProperties(): CommProperties;
  /** 更新当前会话的从站地址（每表独立）：对后续所有请求生效。 */
  setSlaveAddress(slave: number): void;
  /**
   * 更新活动表地址变换配置（表级 Address Adjust）：
   * 对后续读/写请求生效；null=不调整。
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
  /** 单行读取（多寄存器行返回 values[]）。 */
  readRow(
    row: RegisterRow,
    route?: RequestRoute,
  ): Promise<Result<number | number[]>>;
  /**
   * 单行写（FC0x10）。options.writeVerify：每表写后回读配置，
   * 非 off 时写入后按配置（立即/延迟）FC03 回读，返回扩展的 WriteOutcome。
   */
  writeRow(
    row: RegisterRow,
    options?: { writeVerify?: ReadVerifySettings },
    route?: RequestRoute,
  ): Promise<Result<WriteOutcome>>;
  readAllRows(rows: BatchReadRow[], route?: RequestRoute): BatchReadHandle;
}

/** 工作区轮询目标与启停。 */
export interface PollingHost {
  updatePollingTargets(
    rows: Array<{
      key: string;
      sheetId: string;
      address: number;
      quantity?: number;
      route?: RequestRoute;
    }>,
  ): void;
  startPolling(): void;
  stopPolling(): void;
  subscribePollResult(listener: (event: PollResultEvent) => void): () => void;
}

/** Trace 采样控制与事件。 */
export interface TraceHost {
  traceStart(
    key: string,
    address: number,
    speedMs: number,
    quantity?: number,
    route?: RequestRoute,
    identity?: TraceIdentity,
  ): void;
  traceStop(key: string): void;
  subscribeTraceSample(
    listener: (sample: TraceSampleEvent) => void,
  ): () => void;
}

/** 通信日志和应用消息。 */
export interface LoggingHost {
  subscribeCommLog(
    listener: (event: CommunicationLogEvent) => void,
  ): () => void;
  subscribeMessage(listener: (message: ApplicationMessage) => void): () => void;
  pushMessage(
    level: "info" | "warning" | "error",
    messageKey: string,
    detail?: string,
  ): void;
}

/** 系统剪贴板。 */
export interface ClipboardHost {
  /** 把文本写入系统剪贴板；无权限/非安全上下文时返回结构化错误。 */
  copyTextToClipboard(text: string): Promise<Result<void>>;
  /** 读取系统剪贴板文本；无内容返回 ok(null)。 */
  readTextFromClipboard(): Promise<Result<string | null>>;
}

/** 平台文件交换。 */
export interface FileHost {
  /**
   * 保存文本文件（通信日志 CSV 导出）：
   * 浏览器触发 Blob 下载；桌面端弹保存对话框落盘（用户取消返回 ok({ saved: false })）。
   */
  saveTextFile(options: {
    suggestedName: string;
    content: string;
    mimeType?: string;
  }): Promise<Result<SaveTextFileResponse>>;
  /**
   * 打开文件对话框并读取 UTF-8 文本（工作区导入）：
   * 用户取消返回 ok({ content: null })；浏览器客户端上传不调用本端口。
   */
  openTextFile(options?: {
    suggestedName?: string;
  }): Promise<Result<OpenTextFileResponse>>;
}

/** 插件注册、安装和宿主运行时桥。 */
export interface PluginHost {
  readonly pluginRegistry: PluginRegistry;
  /**
   * 启动插件系统：加载已安装插件、装配执行面并启动持久化订阅。
   * 无插件存储端口的宿主为 no-op（无手动安装能力）。
   */
  startPlugins(): Promise<void>;
  /** Preview in isolation and dispose before returning; abort revokes pending consent. */
  previewPluginEntry(
    entrySource: string,
    executionMode: PluginExecutionMode,
    signal?: AbortSignal,
  ): Promise<Result<PluginManifest>>;
  /** Enable only records whose content and declared execution mode still match consent. */
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<Result<void>>;
  /** Confirm the previewed source; executionMode must match the manifest requirements. */
  installPluginEntry(
    entrySource: string,
    executionMode: PluginExecutionMode,
  ): Promise<Result<PluginManifest>>;
  pluginRuntimeLoad(payload: PluginRuntimeLoadPayload): Promise<Result<null>>;
  pluginRuntimeUnload(
    payload: PluginRuntimeUnloadPayload,
  ): Promise<Result<null>>;
  pluginRpc(payload: PluginRpcPayload): Promise<Result<unknown>>;
  pluginContributionQuery(payload?: {
    pointId?: string;
  }): Promise<Result<PluginContributionQueryResponse>>;
}

/**
 * Host 销毁与平台生命周期。
 *
 * 生命周期桥是按运行环境装配的可选能力；UI 必须先检查能力矩阵中的
 * `backgroundLifecycle` / `keepAwake` / `hardwareBack`，再调用可选方法。
 */
export interface PlatformLifecycleHost {
  /**
   * 释放全部资源（页面卸载 / Webview 销毁 / StrictMode 重复挂载清理）：
   * 断开会话、退订外部事件源并清空本地订阅集合。
   */
  dispose(): Promise<void>;
  /**
   * 应用进入/离开后台（移动端生命周期）。
   * 挂起时暂停轮询与追踪（保留配置），恢复时按原配置重启；幂等。
   */
  setBackgroundSuspended?(suspended: boolean): void;
  /** 屏幕常亮：有持续轮询/追踪时开启。 */
  setKeepScreenOn?(enabled: boolean): void;
  /**
   * 订阅硬件返回键。handler 返回 true 表示已消费，false 时宿主最小化应用。
   * 返回取消订阅函数；平台无硬件返回键时返回 null。
   */
  onHardwareBack?(handler: () => boolean): (() => void) | null;
}

/** UI 使用的完整 Host 契约：仅由窄职责契约组合，不承载具体业务实现。 */
export type AppHost = HostIdentity &
  WorkspaceHost &
  CommunicationHost &
  PollingHost &
  TraceHost &
  LoggingHost &
  ClipboardHost &
  FileHost &
  PluginHost &
  PlatformLifecycleHost;

export type BooleanPlatformCapability = {
  [
    Key in keyof PlatformCapabilities
  ]-?: PlatformCapabilities[Key] extends boolean ? Key : never;
}[keyof PlatformCapabilities];

/** UI 能力门控入口：boolean 能力必须经矩阵判断，不以方法存在性探测平台能力。 */
export function hasPlatformCapability(
  capabilities: PlatformCapabilities,
  capability: BooleanPlatformCapability,
): boolean {
  return capabilities[capability];
}
