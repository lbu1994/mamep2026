/**
 * 插件注册表（浏览器 MVP：仅内置插件，清单驱动，启用/禁用，错误隔离）。
 * 平台能力过滤：浏览器不接受 node-only 插件；加载错误不阻止应用启动。
 * 来源标记（2026-08-30，ADR-038）：builtin=随应用构建的内置插件（不持久化），
 * installed=用户经安装入口注册的插件（持久化 manifest + 启用状态）。
 * 可执行化扩展（2026-08-31，ADR-039）：register 校验兼容性（apiVersion 三级判定）、
 * 经贡献点注册表登记 contributes（逐点错误隔离）、可选内置同进程 runtime 激活
 * （activate/deactivate + PLUGIN_HOOK_FAILED 错误隔离，贡献随状态过滤）。
 */
import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";
import { pluginManifestSchema, type PluginManifest } from "./manifest";
import {
  checkCompatibility,
  incompatibleError,
  type CompatibilityResult,
} from "./compatibility";
import { validatePermissions, type PermissionId } from "./permissions";
import {
  ContributionPointRegistry,
  type Contribution,
  type ContributionPointId,
} from "./contributions";
import {
  PLUGIN_STORE_SCHEMA_VERSION,
  type PluginExecutionMode,
  type PluginStoreData,
  type PluginStoreSnapshot,
} from "./plugin-store";
import {
  PLUGIN_HOOK_FAILED,
  type PluginContext,
  type PluginLifecycleState,
  type PluginRemoteRuntime,
  type PluginRuntime,
  type PluginSyncRegistries,
} from "./lifecycle";
import {
  createUnavailableCommunicationApi,
  type PluginCommunicationApi,
} from "./plugin-communication-api";

/** 插件来源：builtin=内置（随应用构建，不持久化）；installed=用户安装（持久化）。 */
export type PluginSource = "builtin" | "installed";

export interface PluginLoadError {
  pluginId: string | null;
  errorCode: string;
  message: string;
}

export type PluginRegistryEvent =
  | { type: "registered"; pluginId: string }
  | { type: "enabled-changed"; pluginId: string; enabled: boolean }
  | { type: "lifecycle-changed"; pluginId: string; state: PluginLifecycleState }
  | { type: "unregistered"; pluginId: string };

/** 卸载错误码（ADR-044 Phase F-1）。 */
export const PLUGIN_NOT_FOUND = "PLUGIN_NOT_FOUND";
export const PLUGIN_BUILTIN_NOT_REMOVABLE = "PLUGIN_BUILTIN_NOT_REMOVABLE";
/** 工具栏动作错误码（2026-09-02 插件外部化）：插件未声明/无法处理该动作。 */
export const PLUGIN_ACTION_NOT_HANDLED = "PLUGIN_ACTION_NOT_HANDLED";

export interface PluginRegistryOptions {
  /** 贡献点注册表（ADR-039）：未提供则跳过 contributes 校验与聚合。 */
  contributionRegistry?: ContributionPointRegistry;
  /** 插件通信面（ADR-039）：未提供则使用「无会话」兜底（返回能力错误）。 */
  communicationApi?: PluginCommunicationApi;
  /**
   * 按插件 id 动态构造通信面（2026-09-02，插件外部化）：同进程 runtime 的 ctx.communication
   * 按 pluginId 绑定，经统一调度器记录来源插件；优先于 communicationApi。
   */
  communicationApiFactory?: (pluginId: string) => PluginCommunicationApi;
  /**
   * 同步贡献注册面（2026-09-12，ADR-054）：插件 `activate(ctx)` 经 `ctx.registries` 注册
   * codec/dataType/addressTransform。未提供则用「不可用」兜底（注册返回能力错误）。
   */
  syncRegistries?: PluginSyncRegistries;
}

/** 同步注册面不可用时的兜底（未注入注册表的宿主 / 测试）。 */
export function createUnavailableSyncRegistries(): PluginSyncRegistries {
  const unavailable = () =>
    fail(
      createMamepError({
        code: "PLUGIN_SYNC_REGISTRY_UNAVAILABLE",
        category: "capability",
        userMessageKey: "errors.pluginRuntimeNotAvailable",
        technicalMessage:
          "plugin sync registries are not available on this host",
      }),
    );
  return {
    codec: { register: unavailable, list: () => [] },
    dataType: { register: unavailable, get: () => undefined, list: () => [] },
    addressTransform: {
      register: unavailable,
      get: () => undefined,
      list: () => [],
    },
  };
}

interface RegisteredPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  source: PluginSource;
  runtime: PluginRuntime | undefined;
  /** 隔离线程运行时（ADR-044 Phase F-2）：installed 第三方插件 entry 在此执行。 */
  remoteRuntime: PluginRemoteRuntime | undefined;
  /** 单文件 JS 插件源码（installed 可执行插件持久化用；纯清单插件为 null）。 */
  entrySource: string | null;
  /** 执行模式（ADR-054）：随快照持久化，重启后据此重建执行面；无执行面时为 undefined。 */
  executionMode: PluginExecutionMode | undefined;
  lifecycleState: PluginLifecycleState;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, RegisteredPlugin>();
  private readonly loadErrors: PluginLoadError[] = [];
  private readonly listeners = new Set<(event: PluginRegistryEvent) => void>();
  private readonly contributionRegistry: ContributionPointRegistry | undefined;
  private readonly communicationApi: PluginCommunicationApi;
  /** 按插件 id 动态通信面工厂（2026-09-02 插件外部化）：优先于 communicationApi。 */
  private readonly communicationApiFactory:
    ((pluginId: string) => PluginCommunicationApi) | undefined;
  /** 同步贡献注册面（ADR-054）：注入到插件 `ctx.registries`。 */
  private readonly syncRegistries: PluginSyncRegistries;
  /** 变更版本号（注册/启停/生命周期变化时自增）：UI 消费方响应式订阅用（ADR-039）。 */
  private version = 0;

  constructor(options: PluginRegistryOptions = {}) {
    this.contributionRegistry = options.contributionRegistry;
    this.communicationApi =
      options.communicationApi ?? createUnavailableCommunicationApi();
    this.communicationApiFactory = options.communicationApiFactory;
    this.syncRegistries =
      options.syncRegistries ?? createUnavailableSyncRegistries();
  }

  register(
    input: unknown,
    options?: {
      source?: PluginSource;
      runtime?: PluginRuntime;
      /** 隔离线程运行时（ADR-044 Phase F-2）：installed 插件 entry 在 Worker/worker_threads 执行。 */
      remoteRuntime?: PluginRemoteRuntime;
      /** 单文件 JS 插件源码（随快照持久化，重启后重新创建运行时）。 */
      entrySource?: string;
      /** 执行模式（ADR-054）：缺省按提供的运行时推断（runtime → same-process / remoteRuntime → isolated）。 */
      executionMode?: PluginExecutionMode;
    },
  ): Result<PluginManifest> {
    const source = options?.source ?? "builtin";
    const runtime = options?.runtime;
    const remoteRuntime = options?.remoteRuntime;
    const entrySource = options?.entrySource ?? null;
    const executionMode: PluginExecutionMode | undefined =
      options?.executionMode ??
      (runtime !== undefined
        ? "same-process"
        : remoteRuntime !== undefined
          ? "isolated"
          : undefined);

    const validated = pluginManifestSchema.safeParse(input);
    if (!validated.success) {
      const error: PluginLoadError = {
        pluginId: null,
        errorCode: "PLUGIN_MANIFEST_INVALID",
        message: validated.error.message,
      };
      this.loadErrors.push(error);
      return fail(
        createMamepError({
          code: "PLUGIN_MANIFEST_INVALID",
          category: "plugin",
          userMessageKey: "errors.pluginManifestInvalid",
          technicalMessage: validated.error.message,
        }),
      );
    }
    const manifest = validated.data;

    // 平台能力过滤：浏览器不接受 node-only 插件。
    if (manifest.platform.node && !manifest.platform.web) {
      const error: PluginLoadError = {
        pluginId: manifest.id,
        errorCode: "PLUGIN_PLATFORM_UNSUPPORTED",
        message: `plugin ${manifest.id} requires the node platform`,
      };
      this.loadErrors.push(error);
      return fail(
        createMamepError({
          code: "PLUGIN_PLATFORM_UNSUPPORTED",
          category: "capability",
          userMessageKey: "errors.pluginPlatformUnsupported",
          technicalMessage: `plugin ${manifest.id} requires the node platform`,
        }),
      );
    }

    if (this.plugins.has(manifest.id)) {
      const error: PluginLoadError = {
        pluginId: manifest.id,
        errorCode: "PLUGIN_ALREADY_REGISTERED",
        message: `plugin ${manifest.id} is already registered`,
      };
      this.loadErrors.push(error);
      return fail(
        createMamepError({
          code: "PLUGIN_ALREADY_REGISTERED",
          category: "plugin",
          userMessageKey: "errors.pluginAlreadyRegistered",
          technicalMessage: `plugin ${manifest.id} is already registered`,
        }),
      );
    }

    // 兼容性三级判定（ADR-039）：forbidden 阻断；loadable-warning 记录警告不阻断。
    const compat: CompatibilityResult = checkCompatibility(manifest.apiVersion);
    if (compat.verdict === "forbidden") {
      this.loadErrors.push({
        pluginId: manifest.id,
        errorCode: "PLUGIN_VERSION_INCOMPATIBLE",
        message: compat.reason ?? "incompatible plugin apiVersion",
      });
      return fail(incompatibleError(manifest.id, compat.reason ?? "unknown"));
    }
    if (compat.verdict === "loadable-warning" && compat.reason) {
      this.loadErrors.push({
        pluginId: manifest.id,
        errorCode: "PLUGIN_VERSION_WARNING",
        message: compat.reason,
      });
    }

    // 权限防御（manifest schema 已枚举校验，此处显式校验未知权限拒绝路径）。
    const permissionResult: Result<PermissionId[]> = validatePermissions(
      manifest.permissions,
    );
    if (!permissionResult.ok) {
      this.loadErrors.push({
        pluginId: manifest.id,
        errorCode: "PLUGIN_PERMISSION_DENIED",
        message: "permissions contain unknown ids",
      });
      return fail(permissionResult.error);
    }

    // runtime 允许 builtin 同进程（ADR-039 最小执行面）与 installed（ADR-054：用户安装时
    // 显式授权「同进程执行」，用于贡献 codec/dataType/addressTransform 等同步能力）。
    // remoteRuntime（隔离执行）仅限 installed 来源；builtin 直接用同进程 runtime。
    if (remoteRuntime !== undefined && source !== "installed") {
      const error: PluginLoadError = {
        pluginId: manifest.id,
        errorCode: PLUGIN_HOOK_FAILED,
        message: `remoteRuntime is only allowed for installed plugins (${manifest.id})`,
      };
      this.loadErrors.push(error);
      return fail(
        createMamepError({
          code: PLUGIN_HOOK_FAILED,
          category: "plugin",
          userMessageKey: "errors.pluginRuntimeNotAvailable",
          technicalMessage: `remoteRuntime is only allowed for installed plugins (${manifest.id})`,
        }),
      );
    }

    // 贡献点登记（ADR-039）：逐点校验，未知点/坏 payload 记错误但不阻断注册。
    if (this.contributionRegistry) {
      const contribErrors = this.contributionRegistry.addContributions(
        manifest.id,
        manifest.contributes,
      );
      for (const e of contribErrors) {
        this.loadErrors.push({
          pluginId: e.pluginId,
          errorCode: e.errorCode,
          message: e.message,
        });
      }
      this.contributionRegistry.setContributionsActive(manifest.id, true);
    }

    this.plugins.set(manifest.id, {
      manifest,
      enabled: true,
      source,
      runtime,
      remoteRuntime,
      entrySource,
      executionMode,
      lifecycleState:
        runtime !== undefined || remoteRuntime !== undefined
          ? "active"
          : "registered",
    });
    if (runtime !== undefined) {
      this.activatePlugin(manifest.id);
    } else if (remoteRuntime !== undefined) {
      void this.activateRemotePlugin(manifest.id);
    }
    this.emit({ type: "registered", pluginId: manifest.id });
    return ok(manifest);
  }

  /**
   * 卸载插件（ADR-044 Phase F-1）：仅 installed 来源可卸载（builtin 随应用构建、不可卸载）。
   * 流程：deactivate runtime（异常 → PLUGIN_HOOK_FAILED 错误隔离，仍继续卸载）→
   * 回收贡献点（removePluginContributions）→ 从注册表删除 → emit unregistered。
   * 未注册 → PLUGIN_NOT_FOUND；builtin → PLUGIN_BUILTIN_NOT_REMOVABLE。
   */
  unregister(pluginId: string): Result<void> {
    const plugin = this.plugins.get(pluginId);
    if (plugin === undefined) {
      return fail(
        createMamepError({
          code: PLUGIN_NOT_FOUND,
          category: "plugin",
          userMessageKey: "errors.pluginNotFound",
          technicalMessage: `plugin ${pluginId} is not registered`,
        }),
      );
    }
    if (plugin.source !== "installed") {
      return fail(
        createMamepError({
          code: PLUGIN_BUILTIN_NOT_REMOVABLE,
          category: "plugin",
          userMessageKey: "errors.pluginBuiltinNotRemovable",
          technicalMessage: `builtin plugin ${pluginId} cannot be uninstalled`,
        }),
      );
    }
    if (plugin.runtime !== undefined) {
      try {
        plugin.runtime.deactivate?.();
      } catch (err) {
        this.handleHookFailure(pluginId, err);
      }
    }
    if (plugin.remoteRuntime !== undefined) {
      // 关闭隔离线程（ADR-044 Phase F-2）：deactivate + dispose，异常不阻断卸载。
      void plugin.remoteRuntime
        .deactivate?.()
        .then(() => plugin.remoteRuntime?.dispose())
        .catch((err: unknown) => this.handleHookFailure(pluginId, err));
    }
    this.contributionRegistry?.removePluginContributions(pluginId);
    this.plugins.delete(pluginId);
    this.emit({ type: "unregistered", pluginId });
    return ok(undefined);
  }

  list(): PluginManifest[] {
    return [...this.plugins.values()].map((p) => p.manifest);
  }

  /** 某插件生命周期状态（ADR-039）；未注册返回 null。 */
  getLifecycleState(pluginId: string): PluginLifecycleState | null {
    return this.plugins.get(pluginId)?.lifecycleState ?? null;
  }

  isEnabled(pluginId: string): boolean {
    return this.plugins.get(pluginId)?.enabled ?? false;
  }

  /** 插件来源（2026-08-30，ADR-038）：未注册返回 null。 */
  getSource(pluginId: string): PluginSource | null {
    return this.plugins.get(pluginId)?.source ?? null;
  }

  /** 插件同进程 runtime（2026-09-02 插件外部化）：未注册/无 runtime 返回 undefined。 */
  getRuntime(pluginId: string): PluginRuntime | undefined {
    return this.plugins.get(pluginId)?.runtime;
  }
  /**
   * 插件是否可处理工具栏动作（2026-09-02 插件外部化）：runtime 声明了 handler 且已注册。
   */
  canHandleToolbarAction(pluginId: string, _actionId: string): boolean {
    return (
      this.plugins.get(pluginId)?.runtime?.handleToolbarAction !== undefined &&
      this.plugins.get(pluginId)?.enabled === true
    );
  }

  /**
   * 执行插件工具栏动作（2026-09-02 插件外部化）：委托相应插件同进程 runtime 的
   * handleToolbarAction（经 PluginCommunicationApi 走统一调度器）。未注册/无 handler/
   * 已禁用 → PLUGIN_ACTION_NOT_HANDLED 能力错误（UI 层置灰，不会到这里）。
   */
  async invokeToolbarAction(
    pluginId: string,
    actionId: string,
  ): Promise<Result<void>> {
    const plugin = this.plugins.get(pluginId);
    if (plugin?.runtime?.handleToolbarAction === undefined) {
      return fail(
        createMamepError({
          code: PLUGIN_ACTION_NOT_HANDLED,
          category: "plugin",
          userMessageKey: "errors.pluginActionNotHandled",
          technicalMessage: `plugin ${pluginId} does not handle toolbar action ${actionId}`,
        }),
      );
    }
    const ctx: PluginContext = {
      pluginId,
      communication:
        this.communicationApiFactory?.(pluginId) ?? this.communicationApi,
      registries: this.syncRegistries,
    };
    try {
      const result = plugin.runtime.handleToolbarAction.call(
        plugin.runtime,
        actionId,
        ctx,
      );
      if (
        typeof (result as Promise<Result<void>> | undefined)?.then ===
        "function"
      ) {
        const awaited = await result;
        if (awaited === undefined) return ok(undefined);
        return awaited;
      }
      return result === undefined ? ok(undefined) : result;
    } catch (err) {
      this.handleHookFailure(pluginId, err);
      return fail(
        createMamepError({
          code: PLUGIN_HOOK_FAILED,
          category: "plugin",
          userMessageKey: "errors.pluginRuntimeNotAvailable",
          technicalMessage: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    const plugin = this.plugins.get(pluginId);
    if (plugin === undefined || plugin.enabled === enabled) return;
    plugin.enabled = enabled;
    this.contributionRegistry?.setContributionsActive(pluginId, enabled);
    if (plugin.runtime !== undefined) {
      if (enabled) {
        plugin.lifecycleState = "active";
        this.activatePlugin(pluginId);
      } else {
        plugin.lifecycleState = "deactivated";
        try {
          plugin.runtime.deactivate?.();
        } catch (err) {
          this.handleHookFailure(pluginId, err);
        }
      }
    } else if (plugin.remoteRuntime !== undefined) {
      if (enabled) {
        plugin.lifecycleState = "active";
        void this.activateRemotePlugin(pluginId);
      } else {
        plugin.lifecycleState = "deactivated";
        void plugin.remoteRuntime
          .deactivate?.()
          .catch((err: unknown) => this.handleHookFailure(pluginId, err));
      }
    }
    this.emit({ type: "enabled-changed", pluginId, enabled });
  }

  /** 聚合某贡献点的有效贡献（ADR-039；禁用/激活失败的插件贡献被过滤）。 */
  getContributions<TSchema>(
    pointId: ContributionPointId,
  ): Contribution<TSchema>[] {
    return this.contributionRegistry?.getContributions<TSchema>(pointId) ?? [];
  }

  /**
   * 持久化快照（ADR-038）：返回全部 installed 来源插件 + 启用状态 + 执行模式；
   * builtin 插件不入库（避免重启重复注册报 PLUGIN_ALREADY_REGISTERED）。
   * 插件一律由用户手动安装（ADR-054）。
   */
  snapshot(): PluginStoreSnapshot {
    return {
      schemaVersion: PLUGIN_STORE_SCHEMA_VERSION,
      plugins: [...this.plugins.values()]
        .filter((p) => p.source === "installed")
        .map((p) => ({
          manifest: p.manifest,
          enabled: p.enabled,
          ...(p.entrySource !== null ? { entrySource: p.entrySource } : {}),
          ...(p.executionMode !== undefined
            ? { executionMode: p.executionMode }
            : {}),
        })),
    };
  }

  /**
   * 从持久化数据恢复（ADR-038）：注册 stored 插件（source=installed）并应用启用状态。
   * 执行面（同进程 / 隔离）由装配方按 executionMode + entrySource 重新加载（ADR-054）。
   */
  hydrate(data: PluginStoreData): void {
    for (const stored of data.plugins) {
      if (this.plugins.has(stored.manifest.id)) continue;
      const result = this.register(stored.manifest, {
        source: "installed",
        ...(stored.entrySource !== undefined && stored.entrySource !== null
          ? { entrySource: stored.entrySource }
          : {}),
        ...(stored.executionMode !== undefined
          ? { executionMode: stored.executionMode }
          : {}),
      });
      if (result.ok && stored.enabled !== this.isEnabled(stored.manifest.id)) {
        this.setEnabled(stored.manifest.id, stored.enabled);
      }
    }
  }

  /** 插件执行模式（ADR-054）：未注册/无执行面返回 null。 */
  getExecutionMode(pluginId: string): PluginExecutionMode | null {
    return this.plugins.get(pluginId)?.executionMode ?? null;
  }

  /** 单文件 JS 插件源码（ADR-044 Phase F-2）：未注册/纯清单插件返回 null。 */
  getEntrySource(pluginId: string): string | null {
    return this.plugins.get(pluginId)?.entrySource ?? null;
  }

  getLoadErrors(): readonly PluginLoadError[] {
    return this.loadErrors;
  }

  /** 注册表变更版本号（ADR-039）：每次 emit 自增，UI 消费方作为 useSyncExternalStore 快照。 */
  getVersion(): number {
    return this.version;
  }

  subscribe(listener: (event: PluginRegistryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private activatePlugin(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
    if (plugin?.runtime === undefined) return;
    const ctx: PluginContext = {
      pluginId,
      communication:
        this.communicationApiFactory?.(pluginId) ?? this.communicationApi,
      registries: this.syncRegistries,
    };
    try {
      const result = plugin.runtime.activate(ctx);
      if (
        result !== undefined &&
        typeof (result as Promise<void>).catch === "function"
      ) {
        (result as Promise<void>).catch((err: unknown) =>
          this.handleHookFailure(pluginId, err),
        );
      }
    } catch (err) {
      this.handleHookFailure(pluginId, err);
    }
  }

  /** 隔离线程运行时激活（ADR-044 Phase F-2）：异步成功 → active；失败 → PLUGIN_HOOK_FAILED。 */
  private activateRemotePlugin(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
    if (plugin?.remoteRuntime === undefined) return;
    const ctx: PluginContext = {
      pluginId,
      communication: this.communicationApi,
      registries: this.syncRegistries,
    };
    plugin.remoteRuntime
      .activate(ctx)
      .then(() => {
        const current = this.plugins.get(pluginId);
        if (current !== undefined && current.enabled) {
          current.lifecycleState = "active";
          this.emit({
            type: "lifecycle-changed",
            pluginId,
            state: "active",
          });
        }
      })
      .catch((err: unknown) => {
        this.handleHookFailure(pluginId, err);
      });
  }

  private handleHookFailure(pluginId: string, err: unknown): void {
    const plugin = this.plugins.get(pluginId);
    if (plugin === undefined) return;
    plugin.lifecycleState = "failed";
    this.contributionRegistry?.setContributionsActive(pluginId, false);
    this.loadErrors.push({
      pluginId,
      errorCode: PLUGIN_HOOK_FAILED,
      message: err instanceof Error ? err.message : String(err),
    });
    this.emit({ type: "lifecycle-changed", pluginId, state: "failed" });
  }

  private emit(event: PluginRegistryEvent): void {
    this.version += 1;
    for (const listener of this.listeners) listener(event);
  }
}
