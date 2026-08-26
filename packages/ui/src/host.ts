/**
 * UI 侧的 Host 接口：UI 只通过这些用例访问业务能力（docs/AGENTS.md §8.3）。
 * 实现由 apps/web 的 composition root 提供。
 */
import type {
  FlowControl,
  PlatformCapabilities,
  ReadVerifySettings,
  RegisterRow,
  Result,
  RtuConnectionProfile,
  TcpConnectionProfile,
  Workspace,
} from "@mamep2026/domain";
import type {
  BatchReadHandle,
  BatchReadRow,
  CommunicationLogEvent,
  ConnectionState,
  WriteOutcome,
} from "@mamep2026/communication";
import type { SaveStatus } from "@mamep2026/workspace";
import type { PluginRegistry } from "@mamep2026/plugin-api";
import type {
  SerialDeviceHandle,
  SerialPortOption,
  ConnectionConfigLoadResponse,
} from "@mamep2026/platform-api";
import type { ConnectionConfigFile } from "@mamep2026/connection-config";
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
  addressAdjust: "off" | "on";
  connectionState: ConnectionState;
}

export interface AppHost {
  readonly capabilities: PlatformCapabilities;
  readonly isMockMode: boolean;
  readonly pluginRegistry: PluginRegistry;
  /** 应用版本号（根 package.json version，由平台侧 composition root 注入）。 */
  readonly appVersion: string;

  loadWorkspace(): Promise<Result<Workspace>>;
  /** 清除全部持久化数据并返回全新默认工作区（§16.5.5 用户重置损坏工作区）。 */
  resetWorkspace(): Promise<Result<Workspace>>;
  scheduleSave(workspace: Workspace): void;
  getSaveStatus(): SaveStatus;
  subscribeSaveStatus(listener: (status: SaveStatus) => void): () => void;

  supportsWebSerial(): boolean;
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
  ): Promise<Result<void>>;
  /**
   * 加载外部连接对象配置文件（connection-config-load，ADR-023）：
   * - 桌面端（capabilities.connectionConfig === "file"）：读 config/connections.json（经宿主 RPC）；
   * - 浏览器（connectionConfig === "import"）：返回 URL 参数 / 已导入的配置。
   * 未找到/未导入返回 ok({ config: null, sourcePath: null })；解析/读取失败返回 fail。
   */
  loadConnectionConfig(): Promise<Result<ConnectionConfigLoadResponse>>;
  /**
   * 导入配置文件 JSON 文本（浏览器 connectionConfig === "import" 时 UI 读取文件后调用；
   * 桌面端由宿主文件读取，本方法返回 fail）。
   */
  importConnectionConfigText(
    text: string,
  ): Promise<Result<ConnectionConfigFile>>;
  /**
   * TCP 连接（2026-08-23 两端 TCP 接线）：profile 即连接参数（host/port/unitId/超时/重试），
   * 无串口句柄。仅 Electron/VSCode 支持；浏览器返回能力错误（UI 依能力矩阵不调用）。
   */
  connectTcp(profile: TcpConnectionProfile): Promise<Result<void>>;
  disconnect(): Promise<Result<void>>;
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
  subscribeConnectionState(
    listener: (state: ConnectionState) => void,
  ): () => void;

  readRow(row: RegisterRow): Promise<Result<number>>;
  /**
   * 单行写（FC0x10）。options.writeVerify（2026-08-26）：每表写后回读配置，
   * 非 off 时写入后按配置（立即/延迟）FC03 回读，返回扩展的 WriteOutcome（§18.2）。
   */
  writeRow(
    row: RegisterRow,
    options?: { writeVerify?: ReadVerifySettings },
  ): Promise<Result<WriteOutcome>>;
  readAllRows(rows: BatchReadRow[]): BatchReadHandle;

  /** WP 轮询：传入当前启用轮询的有效行；连接状态变化时由 UI 调用 start/stop。 */
  updatePollingTargets(rows: Array<{ key: string; address: number }>): void;
  startPolling(): void;
  stopPolling(): void;
  subscribePollResult(
    listener: (key: string, address: number, result: Result<number>) => void,
  ): () => void;

  traceStart(key: string, address: number, speedMs: number): void;
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
}
