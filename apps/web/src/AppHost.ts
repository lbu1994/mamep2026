/**
 * 浏览器 Host 装配（composition root，docs/TECH_DESIGN.md §5.1.6）。
 * 组装：会话生命周期、轮询/全表读取/Trace 协调器、日志与自动保存。
 */
import type {
  PlatformCapabilities,
  RegisterRow,
  Result,
  RtuConnectionProfile,
  TcpConnectionProfile,
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
import { RtuSessionHost } from "@mamep2026/application";
import type {
  BatchReadHandle,
  BatchReadRow,
  Clock,
  CommunicationLogEvent,
  ConnectionState,
  TransportPort,
  WriteOutcome,
} from "@mamep2026/communication";
import type { ApplicationMessage } from "@mamep2026/logging";
import {
  ApplicationMessageStore,
  CommunicationLogStore,
} from "@mamep2026/logging";
import {
  parseConnectionConfig,
  type ConnectionConfigFile,
} from "@mamep2026/connection-config";
import type {
  ConnectionConfigLoadResponse,
  SerialDeviceHandle,
  SerialPortOption,
  PlatformHost,
} from "@mamep2026/platform-api";
import { PluginRegistry } from "@mamep2026/plugin-api";
import type { SaveStatus, WorkspaceRepositoryPort } from "@mamep2026/workspace";
import { AutoSaveCoordinator } from "@mamep2026/workspace";
import type { AppHost, CommProperties, TraceSampleEvent } from "@mamep2026/ui";
import {
  createMockScenarioRows,
  installMockHooks,
  MockTransport,
} from "@mamep2026/platform-web";
import { parseConnectionConfigFromUrl } from "./connection-config-url";

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
  /** RTU 会话宿主（Application 层）：会话/轮询/追踪/读写的单一编排，浏览器与 VSCode 共用。 */
  private readonly rtu: RtuSessionHost;
  /** 当前会话从站地址（每表独立，2026-08-19）：UI 切换表/修改值时同步，连接时作为初始值。 */
  private currentSlaveAddress = 1;
  /** 当前选中端口显示标签（connect 时传给 rtu 供通信属性展示）。 */
  private portLabel: string | null = null;
  /** 外部连接对象配置文件（ADR-023，浏览器 connectionConfig === "import"）：URL 参数或 UI 导入。 */
  private connectionConfig: ConnectionConfigFile | null = null;
  private connectionConfigSource: string | null = null;

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
    // 浏览器端从 ?connectionConfig=<base64> URL 参数载入连接对象配置（可选便捷入口）。
    // node 测试环境无 window，跳过（生产渲染进程始终有 window）。
    if (typeof window !== "undefined") {
      const urlConfig = parseConnectionConfigFromUrl(window.location.search);
      if (urlConfig !== null && urlConfig.ok) {
        this.connectionConfig = urlConfig.value.config;
        this.connectionConfigSource = urlConfig.value.sourcePath;
      }
      // 解析失败静默忽略（URL 参数仅供便捷载入，不阻塞正常启动）。
    }
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
    this.rtu = new RtuSessionHost({
      clock: this.clock,
      events: {
        onLog: (event) => {
          this.commLogStore.appendFromEvent(event);
          for (const listener of this.commLogListeners) listener(event);
        },
        onStateChange: (state) => {
          // 设备拔出（interrupted）策略由 RtuSessionHost 内部处理（停止轮询/追踪 + 消息）。
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
          // 主机侧消息（如设备拔出）进入 messageStore，经订阅转发到 messageListeners。
          this.messageStore.append(message);
        },
      },
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

  async loadConnectionConfig(): Promise<Result<ConnectionConfigLoadResponse>> {
    // 浏览器无文件系统：返回 URL 参数 / UI 导入的配置（未提供则为空）。
    return ok({
      config: this.connectionConfig,
      sourcePath: this.connectionConfigSource,
    });
  }

  async importConnectionConfigText(
    text: string,
  ): Promise<Result<ConnectionConfigFile>> {
    const parsed = parseConnectionConfig(text);
    if (!parsed.ok) return parsed;
    this.connectionConfig = parsed.value;
    this.connectionConfigSource = "import";
    return ok(parsed.value);
  }

  async enumerateSerialPorts(): Promise<Result<SerialPortOption[]>> {
    // 浏览器走系统原生 picker（browser-picker），不支持自定义枚举列表。
    return fail(
      createMamepError({
        code: "SERIAL_ENUMERATION_UNSUPPORTED",
        category: "capability",
        userMessageKey: "errors.serialEnumerationUnsupported",
        technicalMessage:
          "serial port enumeration is only supported on the Electron platform",
      }),
    );
  }

  async selectSerialPort(
    _portId?: string | null,
  ): Promise<Result<SerialDeviceHandle | null>> {
    // 浏览器端忽略 portId 参数：始终弹系统原生选择框（Web Serial 授权 picker）。
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

    // 会话/协调器编排委托 RtuSessionHost（连接失败时其内部关闭传输，避免端口占用）。
    return this.rtu.connect({
      profile,
      transport,
      slaveAddress: this.currentSlaveAddress,
      portLabel: this.isMockMode ? "Mock Device" : this.portLabel,
    });
  }

  /**
   * 浏览器不支持 Modbus TCP（PRD §7.2、能力矩阵 modbusTcp:false）：
   * UI 依能力矩阵不调用本方法；此处返回能力错误兜底。
   */
  async connectTcp(_profile: TcpConnectionProfile): Promise<Result<void>> {
    return fail(
      createMamepError({
        code: "TCP_UNSUPPORTED",
        category: "capability",
        userMessageKey: "errors.tcpUnsupported",
        technicalMessage: "Modbus TCP is not supported in the browser",
      }),
    );
  }

  async disconnect(): Promise<Result<void>> {
    return this.rtu.disconnect();
  }

  /**
   * 释放全部资源（StrictMode 重复挂载 / 页面卸载清理）：断开会话并清空所有本地订阅
   * 集合，避免旧 host 残留订阅导致事件重复投递（如 comm-log 一条变两条）。
   */
  async dispose(): Promise<void> {
    this.connectionListeners.clear();
    this.commLogListeners.clear();
    this.messageListeners.clear();
    this.saveListeners.clear();
    this.pollResultListeners.clear();
    this.traceListeners.clear();
    await this.rtu.dispose();
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
    return this.rtu.getConnectionState();
  }

  subscribeConnectionState(
    listener: (state: ConnectionState) => void,
  ): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  getCommProperties(): CommProperties {
    const profile = this.rtu.getProfile();
    return {
      protocol: "rtu",
      portLabel: this.rtu.getPortLabel(),
      unitId: null,
      baudRate: profile?.baudRate ?? 9600,
      dataBits: profile?.dataBits ?? 8,
      stopBits: profile?.stopBits ?? 1,
      parity: profile?.parity ?? "none",
      flowControl: profile?.flowControl ?? "off",
      timeoutMs: profile?.requestTimeoutMs ?? 1000,
      retryCount: profile?.retryCount ?? 1,
      rxDelayMs: profile?.interRequestDelayMs ?? 50,
      addressAdjust: profile?.addressAdjust ?? "off",
      connectionState: this.getConnectionState(),
    };
  }

  /** 更新当前会话从站地址（每表独立）：对后续所有请求（读/写/轮询/追踪）生效。 */
  setSlaveAddress(slave: number): void {
    this.currentSlaveAddress = slave;
    this.rtu.setSlaveAddress(slave);
  }

  async readRow(row: RegisterRow): Promise<Result<number>> {
    return this.rtu.readRow(row);
  }

  async writeRow(row: RegisterRow): Promise<Result<WriteOutcome>> {
    return this.rtu.writeRow(row);
  }

  readAllRows(rows: BatchReadRow[]): BatchReadHandle {
    return this.rtu.readAllRows(rows);
  }

  updatePollingTargets(rows: Array<{ key: string; address: number }>): void {
    this.rtu.updatePollingTargets(rows);
  }

  startPolling(): void {
    this.rtu.startPolling();
  }

  stopPolling(): void {
    this.rtu.stopPolling();
  }

  subscribePollResult(
    listener: (key: string, address: number, result: Result<number>) => void,
  ): () => void {
    this.pollResultListeners.add(listener);
    return () => this.pollResultListeners.delete(listener);
  }

  traceStart(key: string, address: number, speedMs: number): void {
    this.rtu.traceStart(key, address, speedMs);
  }

  traceStop(key: string): void {
    this.rtu.traceStop(key);
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
