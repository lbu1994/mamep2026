/**
 * 浏览器 Host 装配（composition root，docs/TECH_DESIGN.md §5.1.6）。
 * 组装：会话生命周期、轮询/全表读取/Trace 协调器、日志与自动保存。
 */
import type {
  PlatformCapabilities,
  ReadVerifySettings,
  RegisterRow,
  Result,
  RtuConnectionProfile,
  TcpConnectionProfile,
  Workspace,
  WorkspaceRecoveryInfo,
  AddressTransform,
} from "@mamep2026/domain";
import {
  browserCapabilities,
  createEmptyWorkspace,
  createMamepError,
  defaultConfig,
  fail,
  FULL_BROWSER_COMPATIBILITY,
  ok,
  type BrowserCompatibility,
} from "@mamep2026/domain";
import { RtuSessionHost } from "@mamep2026/application";
import { createPluginCommunicationApi } from "@mamep2026/application";
import { createWebPluginRemoteRuntime } from "@mamep2026/platform-web";
import type {
  BatchReadHandle,
  BatchReadRow,
  Clock,
  CodecRegistry,
  CommunicationLogEvent,
  CommunicationSession,
  ConnectionState,
  TransportPort,
  WriteOutcome,
} from "@mamep2026/communication";
import type { ApplicationMessage } from "@mamep2026/logging";
import {
  ApplicationMessageStore,
  CommunicationLogStore,
} from "@mamep2026/logging";
import type {
  OpenTextFileResponse,
  SaveTextFileResponse,
  SerialDeviceHandle,
  SerialPortOption,
  PlatformHost,
  PluginContributionQueryResponse,
  PluginRpcPayload,
  PluginRuntimeLoadPayload,
  PluginRuntimeUnloadPayload,
} from "@mamep2026/platform-api";
import {
  BUILTIN_CONTRIBUTION_POINTS,
  ContributionPointRegistry,
  PLUGIN_RUNTIME_NOT_AVAILABLE,
  PluginPersistenceCoordinator,
  PluginRegistry,
} from "@mamep2026/plugin-api";
import type {
  PluginManifest,
  PluginRuntime,
  PluginStorePort,
} from "@mamep2026/plugin-api";
import type { SaveStatus, WorkspaceRepositoryPort } from "@mamep2026/workspace";
import { AutoSaveCoordinator } from "@mamep2026/workspace";
import type { AppHost, CommProperties, TraceSampleEvent } from "@mamep2026/ui";
import {
  createMockScenarioRows,
  detectBrowserCompatibility,
  detectFromBrowser,
  installMockHooks,
  MockTransport,
  type CompatibilityEnv,
} from "@mamep2026/platform-web";

/**
 * 随应用分发的插件条目（2026-09-02 插件外部化）：manifest + 同进程 runtime 工厂。
 * 首次启动一次性安装（register + 持久化）；重启后经 hydrate 恢复注册后由装配层用
 * createRuntime() 重建同进程 runtime（同步能力如 codec/dataType/transform 随代码包恢复）。
 */
export interface BundledPluginEntry {
  pluginId: string;
  manifest: PluginManifest;
  /** 无 runtime 的纯清单插件返回 undefined（如 example-panel）。 */
  createRuntime: () => PluginRuntime | undefined;
}

export interface AppHostOptions {
  capabilities?: PlatformCapabilities;
  /**
   * 浏览器兼容性检测输入（PRD §8.3 / §15.7）：默认从真实 window/navigator 读取；
   * 单测与 e2e 开发覆盖（?compatMiss=1）可注入。桌面端不适用。
   */
  compatibilityEnv?: CompatibilityEnv | undefined;
  platform: PlatformHost | null;
  repository: WorkspaceRepositoryPort;
  mockTransport: boolean;
  /**
   * 插件存储端口（2026-08-30，ADR-038）：提供时装配 PluginPersistenceCoordinator，
   * 启动 hydrate 已安装插件并在注册/启用变化时持久化。浏览器=IndexedDB、
   * Electron/VSCode=主进程/扩展宿主持久化经桥。缺省不装配（无持久化，纯内存）。
   */
  pluginStore?: PluginStorePort | undefined;
  /**
   * codec 注册表（ADR-041 决策 A）：随包插件 activate 填充；connect 时按活动表类型
   * 路由 codecId 会话（软件仅提供调用接口）。缺省不装配（纯 RTU/TCP）。
   */
  codecRegistry?: CodecRegistry | undefined;
  /**
   * 随应用分发的插件（2026-09-02 插件外部化）：首次启动一次性安装，此后与用户安装
   * 插件等同（可禁用/卸载/恢复，状态持久化）。缺省不装配（无随包插件）。
   */
  bundledPlugins?: BundledPluginEntry[] | undefined;
  /**
   * 地址变换解析（2026-09-02 插件外部化）：经随包 address-adjust 插件的
   * AddressTransformRegistry 解析 transformId → 变换；缺省不调整（核心不再内置变换）。
   */
  resolveAddressTransform?:
    ((transformId: string) => AddressTransform | null) | undefined;
}

export class BrowserAppHost implements AppHost {
  readonly capabilities: PlatformCapabilities;
  readonly appVersion = __APP_VERSION__;
  readonly platform = "browser" as const;
  readonly pluginRegistry: PluginRegistry;
  /** 贡献点注册表（ADR-039）：注册内置贡献点并注入 PluginRegistry 校验插件 contributes。 */
  private readonly contributionRegistry: ContributionPointRegistry;
  readonly isMockMode: boolean;
  /** 浏览器兼容性检测结果（PRD §8.3 / §15.7 / TECH_DESIGN §40.2）。 */
  readonly browserCompatibility: BrowserCompatibility;
  private readonly platformHost: PlatformHost | null;
  private readonly repository: WorkspaceRepositoryPort;
  private readonly clock: Clock;
  private readonly mockTransportInstance: MockTransport | null;
  private readonly messageStore = new ApplicationMessageStore(2000);
  private readonly commLogStore = new CommunicationLogStore(10000);
  private readonly autoSave: AutoSaveCoordinator;
  /** 插件持久化协调器（2026-08-30，ADR-038）：null = 未注入插件存储端口（纯内存）。 */
  private readonly pluginPersistence: PluginPersistenceCoordinator | null;
  /** codec 注册表（ADR-041 决策 A）：随包插件 activate 填充；connect 按活动表协议路由。 */
  private readonly codecRegistry: CodecRegistry | null;
  /** 随应用分发的插件清单（2026-09-02 插件外部化）。 */
  private readonly bundledPlugins: BundledPluginEntry[];
  /** 地址变换解析（2026-09-02 插件外部化）：随包 address-adjust 插件注册表经装配注入。 */
  private readonly resolveAddressTransform:
    ((transformId: string) => AddressTransform | null) | null;
  /** RTU 会话宿主（Application 层）：会话/轮询/追踪/读写的单一编排，浏览器与 VSCode 共用。 */
  private readonly rtu: RtuSessionHost;
  /** 当前会话从站地址（每表独立，2026-08-19）：UI 切换表/修改值时同步，连接时作为初始值。 */
  private currentSlaveAddress = 1;
  /** 当前选中端口显示标签（connect 时传给 rtu 供通信属性展示）。 */
  private portLabel: string | null = null;

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
    (key: string, address: number, result: Result<number | number[]>) => void
  >();
  private readonly traceListeners = new Set<
    (sample: TraceSampleEvent) => void
  >();

  constructor(options: AppHostOptions) {
    this.capabilities = options.capabilities ?? browserCapabilities;
    this.platformHost = options.platform;
    this.repository = options.repository;
    this.isMockMode = options.mockTransport;
    // 浏览器兼容性检测（PRD §8.3 / §15.7）：mock 为 dev 模拟传输，不依赖 Web Serial，
    // 视为全部可用；否则按注入环境（默认真实 window/navigator）检测。
    this.browserCompatibility = this.isMockMode
      ? FULL_BROWSER_COMPATIBILITY
      : detectBrowserCompatibility(
          options.compatibilityEnv ?? detectFromBrowser(),
        );
    // 贡献点注册表（2026-08-31，ADR-039）：注册 10 个内置贡献点，插件 contributes 按点校验；
    // 消费方由 UI 层经 host.pluginRegistry.getContributions(id) 读取（启用/失败过滤）。
    this.contributionRegistry = new ContributionPointRegistry();
    for (const point of BUILTIN_CONTRIBUTION_POINTS) {
      this.contributionRegistry.registerPoint(point);
    }
    this.pluginRegistry = new PluginRegistry({
      contributionRegistry: this.contributionRegistry,
      // 同进程 runtime 的插件通信面按 pluginId 绑定（2026-09-02 插件外部化）：
      // 请求经统一调度器执行，日志携带来源插件 id（ADR-039 §3.4）。
      communicationApiFactory: (pluginId) =>
        createPluginCommunicationApi({
          getSession: () => this.rtu.getSession(),
          pluginId,
        }),
    });
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
    // 插件持久化（2026-08-30，ADR-038）：注入存储端口时装配协调器；启动由 startPlugins()
    // 显式执行（先注册随包插件再 hydrate/持久化，2026-09-02 插件外部化时序保证）。
    this.pluginPersistence =
      options.pluginStore !== undefined
        ? new PluginPersistenceCoordinator(
            this.pluginRegistry,
            options.pluginStore,
          )
        : null;
    // 随应用分发插件清单（2026-09-02 插件外部化）。
    this.bundledPlugins = options.bundledPlugins ?? [];
    this.resolveAddressTransform = options.resolveAddressTransform ?? null;
    // codec 注册表（ADR-041 决策 A）：随包插件 activate 填充；connect 按活动表协议路由。
    this.codecRegistry = options.codecRegistry ?? null;
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
      ...(this.resolveAddressTransform !== null
        ? { resolveAddressTransform: this.resolveAddressTransform }
        : {}),
    });
  }

  /**
   * 启动插件系统（2026-09-02 插件外部化；App 装配后显式调用）：
   * 1. 首次启动（store 未 seeded）：一次性安装随包插件（register + runtime），
   *    持久化快照（manifest + enabled）并标记 seeded；
   * 2. 重启（seeded）：hydrate 恢复全部 installed 插件（含随包条目，无 runtime），
   *    装配层按代码清单重建同进程 runtime（attachRuntime → 恢复同步能力）；用户已卸载的
   *    随包插件不在 store 中 → 不再注册（卸载持久生效）；
   * 3. 恢复用户安装的可执行插件（远程运行时）。
   */
  async startPlugins(): Promise<void> {
    if (this.pluginPersistence === null) {
      // 无持久化端口：直接注册随包插件（纯内存，测试/无存储环境）。
      for (const entry of this.bundledPlugins) {
        if (this.pluginRegistry.getSource(entry.pluginId) !== null) continue;
        const runtime = entry.createRuntime();
        this.pluginRegistry.register(entry.manifest, {
          source: "installed",
          ...(runtime !== undefined ? { runtime } : {}),
        });
      }
      return;
    }
    const initResult = await this.pluginPersistence.init();
    if (!initResult.ok) {
      // 存储损坏/不可用：降级为内存注册随包插件（错误经协调器 onError 已上报）。
      for (const entry of this.bundledPlugins) {
        if (this.pluginRegistry.getSource(entry.pluginId) !== null) continue;
        const runtime = entry.createRuntime();
        this.pluginRegistry.register(entry.manifest, {
          source: "installed",
          ...(runtime !== undefined ? { runtime } : {}),
        });
      }
      return;
    }
    if (!this.pluginPersistence.isSeeded()) {
      // 首次启动：一次性安装随包插件。
      for (const entry of this.bundledPlugins) {
        if (this.pluginRegistry.getSource(entry.pluginId) !== null) continue;
        const runtime = entry.createRuntime();
        this.pluginRegistry.register(entry.manifest, {
          source: "installed",
          ...(runtime !== undefined ? { runtime } : {}),
        });
      }
      this.pluginPersistence.markSeeded();
      await this.pluginPersistence.flush();
    } else {
      // 重启：hydrate 已注册（store 中的随包条目，无 runtime）→ 按代码清单重建同进程 runtime。
      for (const entry of this.bundledPlugins) {
        if (this.pluginRegistry.getSource(entry.pluginId) !== "installed") {
          continue;
        }
        const runtime = entry.createRuntime();
        if (runtime === undefined) continue;
        if (this.pluginRegistry.getRuntime(entry.pluginId) !== undefined) {
          continue;
        }
        this.pluginRegistry.attachRuntime(entry.pluginId, runtime);
      }
    }
    void this.restoreRemotePluginRuntimes();
  }

  /**
   * 恢复随应用分发的插件（2026-09-02 插件外部化）：用户卸载后经 Plugin Manager
   * 「恢复」重新安装（register + 持久化）。
   */
  async restoreBundledPlugin(pluginId: string): Promise<void> {
    const entry = this.bundledPlugins.find((p) => p.pluginId === pluginId);
    if (entry === undefined) return;
    if (this.pluginRegistry.getSource(pluginId) !== null) return;
    const runtime = entry.createRuntime();
    this.pluginRegistry.register(entry.manifest, {
      source: "installed",
      ...(runtime !== undefined ? { runtime } : {}),
    });
    if (this.pluginPersistence !== null) {
      await this.pluginPersistence.flush();
    }
  }

  /** 恢复全部已卸载的随包插件（Plugin Manager「恢复全部」）。 */
  async restoreAllBundledPlugins(): Promise<void> {
    for (const entry of this.bundledPlugins) {
      await this.restoreBundledPlugin(entry.pluginId);
    }
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

  /** 立即保存当前待写快照（应用关闭/页面隐藏前调用，ADR-049）。 */
  async flush(): Promise<Result<void>> {
    return this.autoSave.flush();
  }

  /** 最近一次加载的恢复元数据（ADR-049 恢复提示）。 */
  getWorkspaceRecoveryInfo(): WorkspaceRecoveryInfo | null {
    return this.repository.getRecoveryInfo();
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
    return this.browserCompatibility.webSerial;
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
    if (this.platformHost === null) {
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
    const result = await this.platformHost.requestSerialPort();
    if (result.ok && result.value !== null) {
      this.portLabel = result.value.label;
    }
    return result;
  }

  async connect(
    profile: RtuConnectionProfile,
    handle: SerialDeviceHandle | null,
    options?: { protocol?: string },
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
      if (this.platformHost === null) {
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
      const openResult = await this.platformHost.openSerialTransport(
        handle,
        profile,
      );
      if (!openResult.ok) return openResult;
      transport = openResult.value;
    }

    // 协议路由（ADR-041 决策 A）：缺省 rtu；活动表为安川表时 protocol=codecId，
    // 需 codecRegistry 已装配（内置安川插件 activate 填充），否则返回能力错误而非崩溃。
    const protocol = options?.protocol ?? "rtu";
    if (protocol !== "rtu" && this.codecRegistry === null) {
      return fail(
        createMamepError({
          code: "CODEC_NOT_FOUND",
          category: "capability",
          userMessageKey: "errors.internal",
          technicalMessage: `codec not available for protocol: ${protocol}`,
        }),
      );
    }

    // 会话/协调器编排委托 RtuSessionHost（连接失败时其内部关闭传输，避免端口占用）。
    return this.rtu.connect({
      profile,
      transport,
      slaveAddress: this.currentSlaveAddress,
      portLabel: this.isMockMode ? "Mock Device" : this.portLabel,
      ...(protocol !== "rtu" ? { protocol } : {}),
      ...(protocol !== "rtu" && this.codecRegistry !== null
        ? { codecRegistry: this.codecRegistry }
        : {}),
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

  // ---- 通信日志 CSV 导出（2026-08-28，PRD §8.3 P1）：浏览器 Blob 下载 ----

  async saveTextFile(options: {
    suggestedName: string;
    content: string;
    mimeType?: string;
  }): Promise<Result<SaveTextFileResponse>> {
    try {
      const blob = new Blob([options.content], {
        type: options.mimeType ?? "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = options.suggestedName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      return ok({ saved: true, filePath: null });
    } catch (cause) {
      return fail(
        createMamepError({
          code: "SAVE_TEXT_FILE_FAILED",
          category: "internal",
          userMessageKey: "panel.exportFailed",
          technicalMessage:
            cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
  }

  // ---- 工作区导入（2026-08-29，PRD §8.3 P1）：浏览器走客户端文件选择（Upload），
  // 不走本端口；本方法按能力矩阵如实返回能力错误（UI 依 workspaceImport === "upload" 分支）。----

  openTextFile(_options?: {
    suggestedName?: string;
  }): Promise<Result<OpenTextFileResponse>> {
    return Promise.resolve(
      fail(
        createMamepError({
          code: "OPEN_TEXT_FILE_UNSUPPORTED",
          category: "capability",
          userMessageKey: "errors.workspaceImportUnsupported",
          technicalMessage:
            "browser reads workspace files via client-side file picker",
        }),
      ),
    );
  }

  // ---- 插件运行时桥（2026-08-31，ADR-039）：浏览器无宿主桥，如实返回能力错误；
  // 契约与穷尽守卫先行，运行时语义 Phase F 补齐。----

  pluginRuntimeLoad(_payload: PluginRuntimeLoadPayload): Promise<Result<null>> {
    return Promise.resolve(fail(pluginRuntimeUnavailableError()));
  }

  pluginRuntimeUnload(
    _payload: PluginRuntimeUnloadPayload,
  ): Promise<Result<null>> {
    return Promise.resolve(fail(pluginRuntimeUnavailableError()));
  }

  pluginRpc(_payload: PluginRpcPayload): Promise<Result<unknown>> {
    return Promise.resolve(fail(pluginRuntimeUnavailableError()));
  }

  pluginContributionQuery(_payload?: {
    pointId?: string;
  }): Promise<Result<PluginContributionQueryResponse>> {
    return Promise.resolve(fail(pluginRuntimeUnavailableError()));
  }

  getConnectionState(): ConnectionState {
    return this.rtu.getConnectionState();
  }

  /** 当前会话（ADR-044 Phase F-2）：插件通信面经统一调度器访问；未连接返回 null。 */
  getSession(): CommunicationSession | null {
    return this.rtu.getSession();
  }

  /** 插件隔离运行时（ADR-044 Phase F-2）：Web Worker 加载 entry；通信面按插件 id 动态绑定。 */
  createPluginRemoteRuntime(entrySource: string) {
    return createWebPluginRemoteRuntime(entrySource, (pluginId) =>
      createPluginCommunicationApi({
        getSession: () => this.rtu.getSession(),
        pluginId,
      }),
    );
  }

  /**
   * 重启后恢复可执行插件（ADR-044 Phase F-2）：hydrate 已注册的 installed 插件
   * （entrySource 持久化）重新创建隔离运行时（load 提取 manifest 后附加并激活）。
   */
  private async restoreRemotePluginRuntimes(): Promise<void> {
    for (const manifest of this.pluginRegistry.list()) {
      const id = manifest.id;
      if (this.pluginRegistry.getSource(id) !== "installed") continue;
      if (this.pluginRegistry.getLifecycleState(id) === "active") continue;
      const entrySource = this.pluginRegistry.getEntrySource(id);
      if (entrySource === null) continue;
      const runtime = this.createPluginRemoteRuntime(entrySource);
      const loadResult = await runtime.load();
      if (!loadResult.ok) {
        // 加载失败（entry 损坏/不兼容）：关闭线程，插件保持注册但不激活（错误隔离）。
        void runtime.dispose();
        continue;
      }
      this.pluginRegistry.attachRemoteRuntime(id, runtime);
    }
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
      timeoutMs: profile?.requestTimeoutMs ?? defaultConfig.rtu.requestTimeoutMs,
      retryCount: profile?.retryCount ?? 1,
      rxDelayMs: profile?.interRequestDelayMs ?? 50,
      connectionState: this.getConnectionState(),
    };
  }

  /** 更新当前会话从站地址（每表独立）：对后续所有请求（读/写/轮询/追踪）生效。 */
  setSlaveAddress(slave: number): void {
    this.currentSlaveAddress = slave;
    this.rtu.setSlaveAddress(slave);
  }

  /** 更新活动表地址变换配置（ADR-042）：浏览器 RTU 会话在本地，直接同步。 */
  setAddressTransform(
    config: {
      transformId: string;
      enabled: boolean;
    } | null,
  ): void {
    this.rtu.setAddressTransform(config);
  }

  async readRow(row: RegisterRow): Promise<Result<number | number[]>> {
    return this.rtu.readRow(row);
  }

  async writeRow(
    row: RegisterRow,
    options?: { writeVerify?: ReadVerifySettings },
  ): Promise<Result<WriteOutcome>> {
    return this.rtu.writeRow(row, options);
  }

  readAllRows(rows: BatchReadRow[]): BatchReadHandle {
    return this.rtu.readAllRows(rows);
  }

  updatePollingTargets(
    rows: Array<{ key: string; address: number; quantity?: number }>,
  ): void {
    this.rtu.updatePollingTargets(rows);
  }

  startPolling(): void {
    this.rtu.startPolling();
  }

  stopPolling(): void {
    this.rtu.stopPolling();
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

  traceStart(
    key: string,
    address: number,
    speedMs: number,
    quantity = 1,
  ): void {
    this.rtu.traceStart(key, address, speedMs, quantity);
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

/** 插件运行时不可用（Phase A 无执行/无宿主桥）时返回的结构化能力错误（ADR-039）。 */
function pluginRuntimeUnavailableError() {
  return createMamepError({
    code: PLUGIN_RUNTIME_NOT_AVAILABLE,
    category: "plugin",
    userMessageKey: "errors.pluginRuntimeNotAvailable",
    technicalMessage:
      "plugin runtime is not available in this platform (Phase A)",
  });
}
