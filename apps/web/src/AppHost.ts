/**
 * 浏览器 Host 装配（composition root，docs/TECH_DESIGN.md §5.1.6）。
 * 组装：会话生命周期、轮询/全表读取/Trace 协调器、日志与自动保存。
 */
import type {
  PlatformCapabilities,
  RegisterRow,
  Result,
  RtuConnectionProfile,
  Workspace,
} from "@mamep2026/domain";
import {
  browserCapabilities,
  createEmptyWorkspace,
  createMamepError,
  defaultConfig,
  fail,
  ok,
} from "@mamep2026/domain";
import type {
  BatchReadHandle,
  BatchReadRow,
  Clock,
  CommunicationLogEvent,
  ConnectionState,
  TransportPort,
  WriteOutcome,
} from "@mamep2026/communication";
import {
  BatchReadCoordinator,
  CommunicationSession,
  PollingCoordinator,
  TraceCoordinator,
} from "@mamep2026/communication";
import type { ApplicationMessage } from "@mamep2026/logging";
import {
  ApplicationMessageStore,
  CommunicationLogStore,
} from "@mamep2026/logging";
import type { SerialDeviceHandle, PlatformHost } from "@mamep2026/platform-api";
import { PluginRegistry } from "@mamep2026/plugin-api";
import { RegisterTableService } from "@mamep2026/register-table";
import type { SaveStatus, WorkspaceRepositoryPort } from "@mamep2026/workspace";
import { AutoSaveCoordinator } from "@mamep2026/workspace";
import type { AppHost, CommProperties, TraceSampleEvent } from "@mamep2026/ui";
import {
  createMockScenarioRows,
  installMockHooks,
  MockTransport,
} from "@mamep2026/platform-web";

export interface AppHostOptions {
  capabilities?: PlatformCapabilities;
  platform: PlatformHost | null;
  repository: WorkspaceRepositoryPort;
  mockTransport: boolean;
}

export class BrowserAppHost implements AppHost {
  readonly capabilities: PlatformCapabilities;
  readonly appVersion = __APP_VERSION__;
  readonly pluginRegistry = new PluginRegistry();
  readonly isMockMode: boolean;
  private readonly platform: PlatformHost | null;
  private readonly repository: WorkspaceRepositoryPort;
  private readonly clock: Clock;
  private readonly mockTransportInstance: MockTransport | null;
  private readonly messageStore = new ApplicationMessageStore(2000);
  private readonly commLogStore = new CommunicationLogStore(10000);
  private readonly autoSave: AutoSaveCoordinator;
  private readonly tableService: RegisterTableService;
  private session: CommunicationSession | null = null;
  private polling: PollingCoordinator | null = null;
  private trace: TraceCoordinator | null = null;
  private currentProfile: RtuConnectionProfile | null = null;
  private portLabel: string | null = null;
  private pollingTargets: Array<{ key: string; address: number }> = [];
  private readonly activeTraces = new Map<
    string,
    { address: number; speedMs: number }
  >();

  private readonly connectionListeners = new Set<
    (state: ConnectionState) => void
  >();
  private readonly commLogListeners = new Set<
    (event: CommunicationLogEvent) => void
  >();
  private readonly messageListeners = new Set<
    (message: ApplicationMessage) => void
  >();
  private readonly saveListeners = new Set<(status: SaveStatus) => void>();
  private readonly pollResultListeners = new Set<
    (key: string, address: number, result: Result<number>) => void
  >();
  private readonly traceListeners = new Set<
    (sample: TraceSampleEvent) => void
  >();

  constructor(options: AppHostOptions) {
    this.capabilities = options.capabilities ?? browserCapabilities;
    this.platform = options.platform;
    this.repository = options.repository;
    this.isMockMode = options.mockTransport;
    this.mockTransportInstance = options.mockTransport
      ? new MockTransport()
      : null;
    if (this.mockTransportInstance !== null) {
      // dev-only E2E 钩子：连接前即可预置/断言模拟设备寄存器。
      installMockHooks(this.mockTransportInstance);
    }
    this.clock = options.platform?.clock ?? {
      now: () => Date.now(),
      schedule: (cb, ms) => {
        const id = setTimeout(cb, ms);
        return { cancel: () => clearTimeout(id) };
      },
    };
    this.autoSave = new AutoSaveCoordinator(options.repository, {
      debounceMs: 500,
      now: this.clock.now,
      schedule: this.clock.schedule,
    });
    this.autoSave.onStatusChange((status) => {
      for (const listener of this.saveListeners) listener(status);
    });
    this.messageStore.subscribe((message) => {
      for (const listener of this.messageListeners) listener(message);
    });
    this.tableService = new RegisterTableService({
      getSession: () => this.session,
      getAddressAdjustMode: () => this.currentProfile?.addressAdjust ?? "off",
    });
  }

  async loadWorkspace(): Promise<Result<Workspace>> {
    const result = await this.repository.load();
    if (result.ok) return ok(this.seedMockDefaultSheet(result.value));
    return result;
  }

  async resetWorkspace(): Promise<Result<Workspace>> {
    const cleared = await this.repository.clear();
    if (!cleared.ok) return cleared;
    const fresh = this.createFreshWorkspace();
    // 立即持久化空工作区，避免刷新后残留旧数据。
    this.autoSave.scheduleSave(fresh);
    return ok(fresh);
  }

  /** mock 模式下创建预填分类寄存器的全新工作区；非 mock 返回普通空工作区。 */
  createFreshWorkspace(): Workspace {
    return this.seedMockDefaultSheet(createEmptyWorkspace());
  }

  /**
   * mock 模式下，仅当默认表仍是「未编辑的 defaultRowCount 个空行」时预填分类寄存器
   * （供 E2E/手动测试直接使用 Name/Comment 定位成功/失败场景）。
   * 已编辑、已删除行或非 mock 的工作区保持原样，不做覆盖。
   */
  private seedMockDefaultSheet(workspace: Workspace): Workspace {
    if (!this.isMockMode) return workspace;
    const sheet = workspace.sheets[0];
    if (sheet === undefined) return workspace;
    const expectedRowCount = defaultConfig.registerTable.defaultRowCount;
    if (sheet.rows.length !== expectedRowCount) return workspace;
    const pristine = sheet.rows.every(
      (row) =>
        row.name === "" &&
        row.comment === "" &&
        row.addressDraft === "" &&
        row.addressValue === null,
    );
    if (!pristine) return workspace;
    const seeded = createMockScenarioRows();
    return {
      ...workspace,
      sheets: workspace.sheets.map((s, index) =>
        index === 0
          ? {
              ...s,
              // 预填行（order 1..N）+ 保留的空白行（order N+1..defaultRowCount）。
              rows: [...seeded, ...s.rows.slice(seeded.length)],
              updatedAt: s.updatedAt,
            }
          : s,
      ),
    };
  }

  scheduleSave(workspace: Workspace): void {
    this.autoSave.scheduleSave(workspace);
  }

  getSaveStatus(): SaveStatus {
    return this.autoSave.getStatus();
  }

  subscribeSaveStatus(listener: (status: SaveStatus) => void): () => void {
    this.saveListeners.add(listener);
    return () => this.saveListeners.delete(listener);
  }

  supportsWebSerial(): boolean {
    if (this.isMockMode) return true;
    const serial = navigator.serial;
    return serial !== undefined;
  }

  async selectSerialPort(): Promise<Result<SerialDeviceHandle | null>> {
    if (this.isMockMode) return { ok: true, value: null };
    if (this.platform === null) {
      return {
        ok: false,
        error: {
          code: "WEB_SERIAL_UNSUPPORTED",
          category: "capability",
          severity: "error",
          retryable: false,
          userMessageKey: "errors.webSerialUnsupported",
          technicalMessage: "no platform host",
        },
      };
    }
    const result = await this.platform.requestSerialPort();
    if (result.ok && result.value !== null) {
      this.portLabel = result.value.label;
    }
    return result;
  }

  async connect(
    profile: RtuConnectionProfile,
    handle: SerialDeviceHandle | null,
  ): Promise<Result<void>> {
    // 停止旧连接的轮询与追踪。
    this.stopPolling();
    this.trace?.stopAll();
    await this.session?.disconnect();

    this.currentProfile = profile;

    let transport: TransportPort;
    if (this.isMockMode) {
      // 复用持久 mock 实例（E2E 钩子指向它）。
      const mock = this.mockTransportInstance;
      if (mock === null) {
        return fail(
          createMamepError({
            code: "MOCK_TRANSPORT_MISSING",
            category: "internal",
            userMessageKey: "errors.internal",
            technicalMessage: "mock transport not initialized",
          }),
        );
      }
      await mock.close();
      transport = mock;
    } else {
      if (this.platform === null) {
        return fail(
          createMamepError({
            code: "WEB_SERIAL_UNSUPPORTED",
            category: "capability",
            userMessageKey: "errors.webSerialUnsupported",
            technicalMessage: "no platform host",
          }),
        );
      }
      if (handle === null) {
        return fail(
          createMamepError({
            code: "SERIAL_DEVICE_NOT_SELECTED",
            category: "validation",
            userMessageKey: "errors.selectDeviceFirst",
            technicalMessage: "no serial device selected",
          }),
        );
      }
      const openResult = await this.platform.openSerialTransport(
        handle,
        profile,
      );
      if (!openResult.ok) return openResult;
      transport = openResult.value;
    }

    const session = new CommunicationSession({
      transport,
      clock: this.clock,
      config: profile,
      onLog: (event) => {
        this.commLogStore.appendFromEvent(event);
        for (const listener of this.commLogListeners) listener(event);
      },
      onStateChange: (state) => {
        if (state === "interrupted") {
          // 设备拔出：停止轮询与追踪，并提示用户（§16.2.5）。
          this.stopPolling();
          this.trace?.stopAll();
          this.pushMessage("error", "messages.deviceDisconnected");
        }
        for (const listener of this.connectionListeners) listener(state);
      },
    });
    const result = await session.connect();
    if (!result.ok) {
      return result;
    }
    this.session = session;

    // 重建协调器并恢复轮询/追踪配置。
    this.polling = new PollingCoordinator(session, this.clock, {
      getIntervalMs: () => this.currentProfile?.interRequestDelayMs ?? 50,
    });
    this.polling.onResult((key, address, result) => {
      for (const listener of this.pollResultListeners)
        listener(key, address, result);
    });
    this.trace = new TraceCoordinator(session, this.clock);
    this.trace.onSample((sample) => {
      for (const listener of this.traceListeners) listener(sample);
    });

    if (this.pollingTargets.length > 0) {
      this.polling.setTargets(this.pollingTargets);
      this.polling.start();
    }
    for (const [key, entry] of this.activeTraces) {
      this.trace.start(key, entry.address, entry.speedMs);
    }
    return ok(undefined);
  }

  async disconnect(): Promise<Result<void>> {
    this.stopPolling();
    this.trace?.stopAll();
    const result = await this.session?.disconnect();
    this.session = null;
    return result ?? { ok: true, value: undefined };
  }

  async copyTextToClipboard(text: string): Promise<Result<void>> {
    if (navigator.clipboard === undefined) {
      return fail(clipboardUnavailableError());
    }
    try {
      await navigator.clipboard.writeText(text);
      return ok(undefined);
    } catch {
      return fail(clipboardUnavailableError());
    }
  }

  async readTextFromClipboard(): Promise<Result<string | null>> {
    if (navigator.clipboard === undefined) {
      return fail(clipboardUnavailableError());
    }
    try {
      const text = await navigator.clipboard.readText();
      return ok(text === "" ? null : text);
    } catch {
      return fail(clipboardUnavailableError());
    }
  }

  getConnectionState(): ConnectionState {
    return this.session?.getState() ?? "disconnected";
  }

  subscribeConnectionState(
    listener: (state: ConnectionState) => void,
  ): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  getCommProperties(): CommProperties {
    const profile = this.currentProfile;
    return {
      portLabel: this.isMockMode ? "Mock Device" : this.portLabel,
      baudRate: profile?.baudRate ?? 9600,
      dataBits: profile?.dataBits ?? 8,
      stopBits: profile?.stopBits ?? 1,
      parity: profile?.parity ?? "none",
      flowControl: profile?.flowControl ?? "off",
      slaveAddress: profile?.slaveAddress ?? 1,
      timeoutMs: profile?.requestTimeoutMs ?? 1000,
      retryCount: profile?.retryCount ?? 1,
      rxDelayMs: profile?.interRequestDelayMs ?? 50,
      addressAdjust: profile?.addressAdjust ?? "off",
      connectionState: this.getConnectionState(),
    };
  }

  async readRow(row: RegisterRow): Promise<Result<number>> {
    return this.tableService.readRow(row);
  }

  async writeRow(row: RegisterRow): Promise<Result<WriteOutcome>> {
    return this.tableService.writeRow(row);
  }

  readAllRows(rows: BatchReadRow[]): BatchReadHandle {
    if (this.session === null) {
      return {
        promise: Promise.resolve(
          fail(
            createMamepError({
              code: "CONNECTION_NOT_CONNECTED",
              category: "connection",
              userMessageKey: "errors.notConnected",
              technicalMessage: "no active connection",
            }),
          ),
        ),
        cancel: () => undefined,
      };
    }
    const coordinator = new BatchReadCoordinator(this.session, this.clock);
    return coordinator.readAll(rows, (key, result) => {
      for (const listener of this.pollResultListeners) listener(key, 0, result);
    });
  }

  updatePollingTargets(rows: Array<{ key: string; address: number }>): void {
    this.pollingTargets = rows;
    this.polling?.setTargets(rows);
    if (rows.length > 0 && this.session !== null) {
      this.polling?.start();
    } else {
      this.polling?.stop();
    }
  }

  startPolling(): void {
    if (this.pollingTargets.length > 0 && this.session !== null) {
      this.polling?.start();
    }
  }

  stopPolling(): void {
    this.polling?.stop();
  }

  subscribePollResult(
    listener: (key: string, address: number, result: Result<number>) => void,
  ): () => void {
    this.pollResultListeners.add(listener);
    return () => this.pollResultListeners.delete(listener);
  }

  traceStart(key: string, address: number, speedMs: number): void {
    this.activeTraces.set(key, { address, speedMs });
    this.trace?.start(key, address, speedMs);
  }

  traceStop(key: string): void {
    this.activeTraces.delete(key);
    this.trace?.stop(key);
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
    this.messageStore.append({
      timestamp: this.clock.now(),
      level,
      messageKey,
      detail: detail ?? null,
    });
  }
}

/** 系统剪贴板不可用（无权限、非安全上下文等）时返回的结构化错误。 */
function clipboardUnavailableError() {
  return createMamepError({
    code: "CLIPBOARD_UNAVAILABLE",
    category: "capability",
    severity: "warning",
    userMessageKey: "errors.clipboardUnavailable",
    technicalMessage: "system clipboard is not available in this context",
  });
}
