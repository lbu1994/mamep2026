/**
 * UI 侧的 Host 接口：UI 只通过这些用例访问业务能力（docs/AGENTS.md §8.3）。
 * 实现由 apps/web 的 composition root 提供。
 */
import type {
  PlatformCapabilities,
  RegisterRow,
  Result,
  RtuConnectionProfile,
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
import type { SerialDeviceHandle } from "@mamep2026/platform-api";
import type { ApplicationMessage } from "@mamep2026/logging";

export interface TraceSampleEvent {
  key: string;
  sequence: number;
  rawValue: number;
  timestamp: number;
}

export interface CommProperties {
  portLabel: string | null;
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: string;
  slaveAddress: number;
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

  loadWorkspace(): Promise<Result<Workspace>>;
  scheduleSave(workspace: Workspace): void;
  getSaveStatus(): SaveStatus;
  subscribeSaveStatus(listener: (status: SaveStatus) => void): () => void;

  supportsWebSerial(): boolean;
  selectSerialPort(): Promise<Result<SerialDeviceHandle | null>>;

  connect(
    profile: RtuConnectionProfile,
    handle: SerialDeviceHandle | null,
  ): Promise<Result<void>>;
  disconnect(): Promise<Result<void>>;
  getConnectionState(): ConnectionState;
  getCommProperties(): CommProperties;
  subscribeConnectionState(
    listener: (state: ConnectionState) => void,
  ): () => void;

  readRow(row: RegisterRow): Promise<Result<number>>;
  writeRow(row: RegisterRow): Promise<Result<WriteOutcome>>;
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
}
