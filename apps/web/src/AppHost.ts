/**
 * 浏览器 Host 装配（composition root，docs/TECH_DESIGN.md §5.1.6）。
 * 组装：会话生命周期、轮询/全表读取/Trace 协调器、日志与自动保存。
 */
import type {
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
import {
  createWebPluginRemoteRuntime,
  loadWebPluginEntry,
  hashPluginContent,
} from "@mamep2026/platform-web";
import type {
  TraceIdentity,
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
  pluginManifestSchema,
  runtimeFromLocalEntry,
  createPluginApproval,
  matchesPluginApproval,
  pluginApprovalContent,
  pluginPermissionDenied,
  createUnavailableCommunicationApi,
} from "@mamep2026/plugin-api";
import type {
  PluginExecutionMode,
  PluginLocalEntry,
  PluginManifest,
  PluginRemoteRuntime,
  PluginStorePort,
  PluginSyncRegistries,
  StoredPlugin,
} from "@mamep2026/plugin-api";
import type { SaveStatus, WorkspaceRepositoryPort } from "@mamep2026/workspace";
import { AutoSaveCoordinator } from "@mamep2026/workspace";
import type {
  ClipboardHost,
  CommProperties,
  CommunicationHost,
  FileHost,
  HostIdentity,
  LoggingHost,
  PlatformLifecycleHost,
  PluginHost,
  PollingHost,
  TraceHost,
  TraceSampleEvent,
  WorkspaceHost,
} from "@mamep2026/ui";
import {
  createMockScenarioRows,
  detectBrowserCompatibility,
  detectFromBrowser,
  installMockHooks,
  MockTransport,
  type CompatibilityEnv,
} from "@mamep2026/platform-web";
import { yieldToMainThread as defaultYieldToMainThread } from "./main-thread-scheduler";

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
   * 插件存储端口：提供时启动时加载已安装插件并按 executionMode
   * 装配执行面、在注册/启用变化时持久化。浏览器=IndexedDB、Electron/VSCode=主进程/扩展宿主
   * 持久化经桥。缺省不装配（无持久化，则无手动安装能力）。
   */
  pluginStore?: PluginStorePort | undefined;
  /**
   * codec 注册表：插件 activate 经 ctx.registries.codec 填充；connect 时按
   * 活动表类型路由 codecId 会话（软件仅提供调用接口）。缺省不装配（纯 RTU/TCP）。
   */
  codecRegistry?: CodecRegistry | undefined;
  /**
   * 同步贡献注册面：插件 `activate(ctx)` 经 `ctx.registries` 注册
   * codec / dataType / addressTransform；由组合根（apps/web App.tsx）装配后注入注册表。
   */
  syncRegistries?: PluginSyncRegistries | undefined;
  /**
   * 地址变换解析：经 address-adjust 插件的
   * AddressTransformRegistry 解析 transformId → 变换；缺省不调整（核心不再内置变换）。
   */
  resolveAddressTransform?:
    ((transformId: string) => AddressTransform | null) | undefined;
  /** 插件恢复逐项让出主线程（测试可注入；默认 Scheduler.yield / setTimeout）。 */
  yieldToMainThread?: (() => Promise<void>) | undefined;
}

/** 插件清单校验失败（安装/启动加载路径）。 */
function pluginManifestInvalidError(message: string) {
  return createMamepError({
    code: "PLUGIN_MANIFEST_INVALID",
    category: "plugin",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.pluginManifestInvalid",
    technicalMessage: message,
  });
}

/**
 * 能力矩阵派生：协议扩展 / 表类型 = 平台基础值 + **已启用**插件贡献
 * （平台不支持的能力仍不得由插件引入，基础值来自 platform-web / platform-node / platform-android）。
 * `getContributions` 已按插件启用状态与激活失败过滤。
 */
export function deriveCapabilities(
  base: PlatformCapabilities,
  registry: PluginRegistry,
): PlatformCapabilities {
  const protocolExtensions = new Set(base.protocolExtensions);
  for (const contribution of registry.getContributions<{
    protocolId: string;
  }>("protocolExtension")) {
    protocolExtensions.add(contribution.payload.protocolId);
  }
  const tableTypes = new Set(base.tableTypes);
  for (const contribution of registry.getContributions<{
    id: string;
    protocolId: string;
  }>("tableType")) {
    tableTypes.add(`${contribution.pluginId}:${contribution.payload.id}`);
  }
  return {
    ...base,
    protocolExtensions: [...protocolExtensions],
    tableTypes: [...tableTypes],
  };
}

export class BrowserAppHost
  implements
    HostIdentity,
    WorkspaceHost,
    CommunicationHost,
    PollingHost,
    TraceHost,
    LoggingHost,
    ClipboardHost,
    FileHost,
    PluginHost,
    PlatformLifecycleHost
{
  /** 基础能力：协议扩展 / 表类型由 `get capabilities()` 叠加插件贡献派生。 */
  private readonly baseCapabilities: PlatformCapabilities;
  /**
   * 平台能力矩阵（docs/TECH_DESIGN.md §7）：基础能力 + 已启用插件贡献的协议扩展/表类型。
   * 读取即派生——UI 需在插件安装/启停后重新渲染才能看到新能力
   * （app-store 的 pluginsVersion 承担响应式信号）。
   */
  get capabilities(): PlatformCapabilities {
    return deriveCapabilities(this.baseCapabilities, this.pluginRegistry);
  }
  readonly appVersion = __APP_VERSION__;
  readonly platform = "browser" as const;
  readonly pluginRegistry: PluginRegistry;
  /** 贡献点注册表：注册内置贡献点并注入 PluginRegistry 校验插件 contributes。 */
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
  /** 插件持久化协调器：null = 未注入插件存储端口（纯内存）。 */
  private readonly pluginPersistence: PluginPersistenceCoordinator | null;
  /** 插件存储端口：null = 无手动安装能力（纯内存 / 测试）。 */
  private readonly pluginStore: PluginStorePort | null;
  /** codec 注册表：插件 activate 填充；connect 按活动表协议路由。 */
  private readonly codecRegistry: CodecRegistry | null;
  /** 地址变换解析：address-adjust 插件注册表经装配注入。 */
  private readonly resolveAddressTransform:
    ((transformId: string) => AddressTransform | null) | null;
  private readonly yieldToMainThread: () => Promise<void>;
  /** RTU 会话宿主（Application 层）：会话/轮询/追踪/读写的单一编排，浏览器与 VSCode 共用。 */
  private readonly rtu: RtuSessionHost;
  /** 当前会话从站地址（每表独立）：UI 切换表/修改值时同步，连接时作为初始值。 */
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
    (event: PollResultEvent) => void
  >();
  private readonly traceListeners = new Set<
    (sample: TraceSampleEvent) => void
  >();

  private pluginPreview: { source: string; manifest: PluginManifest } | null =
    null;
  private hostDisposed = false;
  private readonly pluginEnableRequests = new Map<string, object>();

  constructor(options: AppHostOptions) {
    this.baseCapabilities = options.capabilities ?? browserCapabilities;
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
    // 贡献点注册表：注册 10 个内置贡献点，插件 contributes 按点校验；
    // 消费方由 UI 层经 host.pluginRegistry.getContributions(id) 读取（启用/失败过滤）。
    this.contributionRegistry = new ContributionPointRegistry();
    for (const point of BUILTIN_CONTRIBUTION_POINTS) {
      this.contributionRegistry.registerPoint(point);
    }
    this.pluginRegistry = new PluginRegistry({
      contributionRegistry: this.contributionRegistry,
      // 同进程 runtime 的插件通信面按 pluginId 绑定（插件外部化）：
      // 请求经统一调度器执行，日志携带来源插件 id。
      communicationApiFactory: (pluginId, authorization) =>
        createPluginCommunicationApi({
          getSession: () => this.rtu.getSession(),
          getRoute: () =>
            this.rtu.getSession()?.getCurrentRoute() ?? {
              unitAddress: this.currentSlaveAddress,
              protocol: "rtu",
            },
          pluginId,
          authorization,
        }),
      // 同步贡献注册面：插件 activate 经 ctx.registries 注册同步能力。
      ...(options.syncRegistries !== undefined
        ? { syncRegistries: options.syncRegistries }
        : {}),
    });
    this.clock = options.platform?.clock ?? {
      now: () => Date.now(),
      schedule: (cb, ms) => {
        const id = setTimeout(cb, ms);
        return { cancel: () => clearTimeout(id) };
      },
    };
    this.mockTransportInstance = options.mockTransport
      ? new MockTransport()
      : null;
    if (this.mockTransportInstance !== null) {
      // dev-only E2E 钩子：连接前即可预置/断言模拟设备寄存器。
      installMockHooks(this.mockTransportInstance);
    }
    this.autoSave = new AutoSaveCoordinator(options.repository, {
      debounceMs: 500,
      now: this.clock.now,
      schedule: this.clock.schedule,
    });
    this.autoSave.onStatusChange((status) => {
      for (const listener of this.saveListeners) listener(status);
    });
    // 插件持久化：注入存储端口时装配协调器；启动由 startPlugins()
    // 显式执行（先加载已安装插件的执行面再带 runtime 注册）。
    this.pluginPersistence =
      options.pluginStore !== undefined
        ? new PluginPersistenceCoordinator(
            this.pluginRegistry,
            options.pluginStore,
          )
        : null;
    this.pluginStore = options.pluginStore ?? null;
    this.resolveAddressTransform = options.resolveAddressTransform ?? null;
    this.yieldToMainThread =
      options.yieldToMainThread ?? defaultYieldToMainThread;
    // codec 注册表：插件 activate 填充；connect 按活动表协议路由。
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
        onPollResult: (event) => {
          for (const listener of this.pollResultListeners) listener(event);
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
   * 启动插件系统（App 装配后显式调用）：
   * 1. 从插件存储加载已安装插件（无存储端口则跳过——无手动安装能力）；
   * 2. 逐个按 `executionMode` 加载执行面（same-process = 用户授权同进程 import；
   *    isolated = Web Worker 隔离线程）后带 runtime 注册为 installed 插件，并恢复启用状态；
   *    纯清单插件直接注册（无执行面）；执行面加载失败 → 跳过该插件并记录错误（错误隔离）；
   * 3. 启动持久化协调器（订阅后续注册/启停/卸载事件）。
   */
  async startPlugins(): Promise<void> {
    if (this.pluginStore === null || this.hostDisposed) return;
    const loaded = await this.pluginStore.load();
    if (this.hostDisposed) return;
    if (!loaded.ok) {
      this.appendPluginMessage("errors.pluginStoreError", loaded.error.code);
      return;
    }
    for (const stored of loaded.value.plugins) {
      // 单个 Worker/线程启动仍可能占用主线程；插件之间主动让出宏任务，
      // 避免多个插件恢复被 React 合并为一帧长任务。
      await this.yieldToMainThread();
      if (this.hostDisposed) return;
      await this.registerStoredPlugin(stored);
      if (this.hostDisposed) return;
    }
    this.pluginPersistence?.start();
  }

  /** Preview only in isolation and release the runtime before returning its manifest. */
  async previewPluginEntry(
    entrySource: string,
    executionMode: PluginExecutionMode,
  ): Promise<Result<PluginManifest>> {
    void executionMode;
    if (this.hostDisposed) return fail(pluginPermissionDenied("host disposed"));
    this.pluginPreview = null;
    const loaded = await this.loadEntryExecutable(entrySource, "isolated");
    if (!loaded.ok) return loaded;
    try {
      if (this.hostDisposed)
        return fail(pluginPermissionDenied("host disposed"));
      this.pluginPreview = {
        source: entrySource,
        manifest: loaded.value.manifest,
      };
      return ok(structuredClone(loaded.value.manifest));
    } finally {
      await loaded.value.remoteRuntime?.dispose();
    }
  }

  /** Bind user consent to the previewed content before loading the selected execution mode. */
  async installPluginEntry(
    entrySource: string,
    executionMode: PluginExecutionMode,
  ): Promise<Result<PluginManifest>> {
    const preview = this.pluginPreview;
    this.pluginPreview = null;
    if (
      this.hostDisposed ||
      preview === null ||
      preview.source !== entrySource
    ) {
      return fail(
        pluginPermissionDenied("installation requires a matching preview"),
      );
    }
    const approval = await createPluginApproval(
      { manifest: preview.manifest, entrySource, executionMode },
      hashPluginContent,
    );
    if (this.hostDisposed) return fail(pluginPermissionDenied("host disposed"));
    const loaded = await this.loadEntryExecutable(entrySource, executionMode);
    if (!loaded.ok) return loaded;
    const { manifest, localEntry, remoteRuntime } = loaded.value;
    if (
      this.hostDisposed ||
      pluginApprovalContent(manifest, entrySource, executionMode) !==
        pluginApprovalContent(preview.manifest, entrySource, executionMode)
    ) {
      await remoteRuntime?.dispose();
      return fail(
        pluginPermissionDenied("plugin content changed after preview"),
      );
    }
    if (
      this.pluginRegistry.getSource(manifest.id) === "installed" &&
      !this.pluginRegistry.isEnabled(manifest.id)
    ) {
      this.pluginRegistry.unregister(manifest.id);
    }
    const result = this.pluginRegistry.register(manifest, {
      source: "installed",
      entrySource,
      executionMode,
      approval,
      approvedPermissions: approval.permissions,
      ...(localEntry !== undefined
        ? { runtime: runtimeFromLocalEntry(localEntry) }
        : {}),
      ...(remoteRuntime !== undefined ? { remoteRuntime } : {}),
    });
    if (!result.ok) await remoteRuntime?.dispose();
    return result;
  }

  /** Enable a retained executable only after checking its saved approval. */
  async setPluginEnabled(
    pluginId: string,
    enabled: boolean,
  ): Promise<Result<void>> {
    const request = {};
    this.pluginEnableRequests.set(pluginId, request);
    if (!enabled) {
      this.pluginRegistry.setEnabled(pluginId, false);
      return ok(undefined);
    }
    const stored = this.pluginRegistry
      .snapshot()
      .plugins.find((plugin) => plugin.manifest.id === pluginId);
    const isRegistrationCurrent =
      this.pluginRegistry.captureRegistration(pluginId);
    if (stored?.entrySource === undefined) {
      this.pluginRegistry.setEnabled(pluginId, true);
      return ok(undefined);
    }
    if (!(await matchesPluginApproval(stored, hashPluginContent))) {
      return fail(
        pluginPermissionDenied("plugin requires renewed installation consent"),
      );
    }
    if (this.hostDisposed) return fail(pluginPermissionDenied("host disposed"));
    const isCurrent = () =>
      this.pluginEnableRequests.get(pluginId) === request &&
      isRegistrationCurrent();
    if (!isCurrent())
      return fail(pluginPermissionDenied("enable request was revoked"));
    const registered = await this.registerStoredPlugin(
      { ...stored, enabled: true },
      isCurrent,
      true,
    );
    return registered && this.pluginRegistry.isEnabled(pluginId)
      ? ok(undefined)
      : fail(pluginPermissionDenied("plugin could not be enabled"));
  }

  /** 加载 entry 并装配执行面（不注册）；同进程 / 隔离按 executionMode 分支。 */
  private async loadEntryExecutable(
    entrySource: string,
    executionMode: PluginExecutionMode,
  ): Promise<
    Result<{
      manifest: PluginManifest;
      localEntry?: PluginLocalEntry;
      remoteRuntime?: PluginRemoteRuntime;
    }>
  > {
    if (executionMode === "same-process") {
      const entryResult = await loadWebPluginEntry(entrySource);
      if (!entryResult.ok) return entryResult;
      const parsed = pluginManifestSchema.safeParse(entryResult.value.manifest);
      if (!parsed.success) {
        return fail(pluginManifestInvalidError(parsed.error.message));
      }
      return ok({ manifest: parsed.data, localEntry: entryResult.value });
    }
    const remoteRuntime = this.createRemoteRuntime(entrySource);
    const loadResult = await remoteRuntime.load();
    if (!loadResult.ok) {
      void remoteRuntime.dispose();
      return loadResult;
    }
    const parsed = pluginManifestSchema.safeParse(loadResult.value);
    if (!parsed.success) {
      void remoteRuntime.dispose();
      return fail(pluginManifestInvalidError(parsed.error.message));
    }
    return ok({ manifest: parsed.data, remoteRuntime });
  }

  /** Restore metadata first; only enabled records with matching consent may execute. */
  private async registerStoredPlugin(
    stored: StoredPlugin,
    isCurrent = () => true,
    replace = false,
  ): Promise<boolean> {
    if (this.hostDisposed || !isCurrent()) return false;
    const { entrySource, executionMode } = stored;
    if (entrySource === undefined) {
      this.registerStoredManifest(stored.manifest, stored.enabled);
      return this.pluginRegistry.isEnabled(stored.manifest.id);
    }
    const approved = await matchesPluginApproval(stored, hashPluginContent);
    if (this.hostDisposed || !isCurrent()) return false;
    if (!stored.enabled || !approved || executionMode === undefined) {
      this.pluginRegistry.register(stored.manifest, {
        source: "installed",
        entrySource,
        enabled: false,
        ...(executionMode !== undefined ? { executionMode } : {}),
        ...(approved && stored.approval !== undefined
          ? { approval: stored.approval }
          : {}),
      });
      if (!approved)
        this.appendPluginMessage(
          "errors.pluginPermissionDenied",
          `plugin ${stored.manifest.id} requires renewed installation consent`,
        );
      return false;
    }
    const loaded = await this.loadEntryExecutable(entrySource, executionMode);
    if (!loaded.ok) {
      this.appendPluginMessage("errors.pluginLoadFailed", loaded.error.code);
      return false;
    }
    const { manifest, localEntry, remoteRuntime } = loaded.value;
    if (
      this.hostDisposed ||
      !isCurrent() ||
      pluginApprovalContent(manifest, entrySource, executionMode) !==
        pluginApprovalContent(stored.manifest, entrySource, executionMode)
    ) {
      await remoteRuntime?.dispose();
      this.appendPluginMessage(
        "errors.pluginPermissionDenied",
        "plugin manifest changed during restore",
      );
      return false;
    }
    if (replace) this.pluginRegistry.unregister(stored.manifest.id);
    const result = this.pluginRegistry.register(manifest, {
      source: "installed",
      entrySource,
      executionMode,
      ...(stored.approval !== undefined
        ? {
            approval: stored.approval,
            approvedPermissions: stored.approval.permissions,
          }
        : {}),
      ...(localEntry !== undefined
        ? { runtime: runtimeFromLocalEntry(localEntry) }
        : {}),
      ...(remoteRuntime !== undefined ? { remoteRuntime } : {}),
    });
    if (!result.ok) await remoteRuntime?.dispose();
    return result.ok;
  }

  /** 纯清单插件注册 + 恢复启用状态（无执行面，activate/deactivate 均不存在）。 */
  private registerStoredManifest(
    manifest: PluginManifest,
    enabled: boolean,
  ): void {
    const result = this.pluginRegistry.register(manifest, {
      source: "installed",
    });
    if (!result.ok) return;
    if (enabled !== this.pluginRegistry.isEnabled(manifest.id)) {
      this.pluginRegistry.setEnabled(manifest.id, enabled);
    }
  }

  /** 插件相关应用消息（启动期错误经 messageStore 上报，UI 顶部提示）。 */
  private appendPluginMessage(messageKey: string, detail: string): void {
    this.messageStore.append({
      timestamp: this.clock.now(),
      level: "error",
      messageKey,
      params: { detail },
      detail,
    });
  }

  /** 插件隔离运行时：Web Worker 加载 entry；通信面按插件 id 绑定。 */
  private createRemoteRuntime(entrySource: string): PluginRemoteRuntime {
    return createWebPluginRemoteRuntime(
      entrySource,
      createUnavailableCommunicationApi,
    );
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

  /** 立即保存当前待写快照（应用关闭/页面隐藏前调用）。 */
  async flush(): Promise<Result<void>> {
    return this.autoSave.flush();
  }

  /**
   * 应用进入/离开后台（移动端生命周期）：暂停/恢复轮询与追踪。
   * 配置（pollingTargets / activeTraces）保留在会话宿主内，回前台按原配置重启。
   */
  setBackgroundSuspended(suspended: boolean): void {
    if (suspended) {
      this.rtu.pauseBackground();
    } else {
      this.rtu.resumeBackground();
    }
  }

  /** 最近一次加载的恢复元数据（恢复提示）。 */
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

    // 协议路由：缺省 rtu；活动表为安川表时 protocol=codecId，
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
    this.hostDisposed = true;
    this.pluginPreview = null;
    this.pluginEnableRequests.clear();
    this.pluginPersistence?.dispose();
    this.pluginRegistry.dispose();
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

  // ---- 通信日志 CSV 导出（PRD §8.3 P1）：浏览器 Blob 下载 ----

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

  // ---- 工作区导入（PRD §8.3 P1）：浏览器走客户端文件选择（Upload），
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

  // ---- 插件运行时桥：浏览器无宿主桥，如实返回能力错误；
  // 契约与穷尽守卫先行，运行时语义补齐。----

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

  /** 当前会话：插件通信面经统一调度器访问；未连接返回 null。 */
  getSession(): CommunicationSession | null {
    return this.rtu.getSession();
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
      timeoutMs:
        profile?.requestTimeoutMs ?? defaultConfig.rtu.requestTimeoutMs,
      retryCount: profile?.retryCount ?? 1,
      connectionState: this.getConnectionState(),
    };
  }

  /** 更新当前会话从站地址（每表独立）：对后续所有请求（读/写/轮询/追踪）生效。 */
  setSlaveAddress(slave: number): void {
    this.currentSlaveAddress = slave;
    this.rtu.setSlaveAddress(slave);
  }

  /** 更新活动表地址变换配置：浏览器 RTU 会话在本地，直接同步。 */
  setAddressTransform(
    config: {
      transformId: string;
      enabled: boolean;
    } | null,
  ): void {
    this.rtu.setAddressTransform(config);
  }

  private fallbackRoute(): RequestRoute {
    return (
      this.rtu.getSession()?.getCurrentRoute() ?? {
        unitAddress: this.currentSlaveAddress,
        protocol: "rtu",
      }
    );
  }

  async readRow(
    row: RegisterRow,
    route?: RequestRoute,
  ): Promise<Result<number | number[]>> {
    return this.rtu.readRow(row, route ?? this.fallbackRoute());
  }

  async writeRow(
    row: RegisterRow,
    options?: { writeVerify?: ReadVerifySettings },
    route?: RequestRoute,
  ): Promise<Result<WriteOutcome>> {
    return this.rtu.writeRow(row, options, route ?? this.fallbackRoute());
  }

  readAllRows(rows: BatchReadRow[], route?: RequestRoute): BatchReadHandle {
    return this.rtu.readAllRows(rows, undefined, route ?? this.fallbackRoute());
  }

  updatePollingTargets(
    rows: Array<{
      key: string;
      sheetId: string;
      address: number;
      quantity?: number;
      route?: RequestRoute;
    }>,
  ): void {
    this.rtu.updatePollingTargets(rows);
  }

  startPolling(): void {
    this.rtu.startPolling();
  }

  stopPolling(): void {
    this.rtu.stopPolling();
  }

  subscribePollResult(listener: (event: PollResultEvent) => void): () => void {
    this.pollResultListeners.add(listener);
    return () => this.pollResultListeners.delete(listener);
  }

  traceStart(
    key: string,
    address: number,
    speedMs: number,
    quantity = 1,
    route?: RequestRoute,
    identity?: TraceIdentity,
  ): void {
    this.rtu.traceStart(
      key,
      address,
      speedMs,
      quantity,
      route ?? this.fallbackRoute(),
      identity,
    );
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

/** 插件运行时不可用（无执行/无宿主桥）时返回的结构化能力错误。 */
function pluginRuntimeUnavailableError() {
  return createMamepError({
    code: PLUGIN_RUNTIME_NOT_AVAILABLE,
    category: "plugin",
    userMessageKey: "errors.pluginRuntimeNotAvailable",
    technicalMessage:
      "plugin runtime is not available in this platform (Phase A)",
  });
}
