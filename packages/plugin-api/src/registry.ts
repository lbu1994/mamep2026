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
import {
  validatePermissions,
  type PermissionId,
} from "./permissions";
import {
  ContributionPointRegistry,
  type Contribution,
  type ContributionPointId,
} from "./contributions";
import {
  PLUGIN_STORE_SCHEMA_VERSION,
  type PluginStoreData,
} from "./plugin-store";
import {
  PLUGIN_HOOK_FAILED,
  type PluginContext,
  type PluginLifecycleState,
  type PluginRuntime,
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
  | { type: "lifecycle-changed"; pluginId: string; state: PluginLifecycleState };

export interface PluginRegistryOptions {
  /** 贡献点注册表（ADR-039）：未提供则跳过 contributes 校验与聚合。 */
  contributionRegistry?: ContributionPointRegistry;
  /** 插件通信面（ADR-039）：未提供则使用「无会话」兜底（返回能力错误）。 */
  communicationApi?: PluginCommunicationApi;
}

interface RegisteredPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  source: PluginSource;
  runtime: PluginRuntime | undefined;
  lifecycleState: PluginLifecycleState;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, RegisteredPlugin>();
  private readonly loadErrors: PluginLoadError[] = [];
  private readonly listeners = new Set<(event: PluginRegistryEvent) => void>();
  private readonly contributionRegistry: ContributionPointRegistry | undefined;
  private readonly communicationApi: PluginCommunicationApi;
  /** 变更版本号（注册/启停/生命周期变化时自增）：UI 消费方响应式订阅用（ADR-039）。 */
  private version = 0;

  constructor(options: PluginRegistryOptions = {}) {
    this.contributionRegistry = options.contributionRegistry;
    this.communicationApi =
      options.communicationApi ?? createUnavailableCommunicationApi();
  }

  register(
    input: unknown,
    options?: { source?: PluginSource; runtime?: PluginRuntime },
  ): Result<PluginManifest> {
    const source = options?.source ?? "builtin";
    const runtime = options?.runtime;

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

    // runtime 仅限内置同进程使用（Phase A 不加载第三方 entry；隔离机制 Phase F）。
    if (runtime !== undefined && source !== "builtin") {
      const error: PluginLoadError = {
        pluginId: manifest.id,
        errorCode: PLUGIN_HOOK_FAILED,
        message: `runtime is only allowed for builtin plugins (${manifest.id})`,
      };
      this.loadErrors.push(error);
      return fail(
        createMamepError({
          code: PLUGIN_HOOK_FAILED,
          category: "plugin",
          userMessageKey: "errors.pluginRuntimeNotAvailable",
          technicalMessage: `runtime is only allowed for builtin plugins (${manifest.id})`,
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
      lifecycleState: runtime !== undefined ? "active" : "registered",
    });
    if (runtime !== undefined) {
      this.activatePlugin(manifest.id);
    }
    this.emit({ type: "registered", pluginId: manifest.id });
    return ok(manifest);
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
   * 持久化快照（ADR-038）：仅返回 installed 来源插件 + 启用状态，内置插件不入库
   * （避免重启重复注册报 PLUGIN_ALREADY_REGISTERED）。
   */
  snapshot(): PluginStoreData {
    return {
      schemaVersion: PLUGIN_STORE_SCHEMA_VERSION,
      plugins: [...this.plugins.values()]
        .filter((p) => p.source === "installed")
        .map((p) => ({ manifest: p.manifest, enabled: p.enabled })),
    };
  }

  /**
   * 从持久化数据恢复（ADR-038）：注册 stored 插件（source=installed）并应用启用状态。
   * 已注册同 id（内置插件优先）时跳过，不产生加载错误。
   */
  hydrate(data: PluginStoreData): void {
    for (const stored of data.plugins) {
      if (this.plugins.has(stored.manifest.id)) continue;
      const result = this.register(stored.manifest, { source: "installed" });
      if (result.ok && stored.enabled !== this.isEnabled(stored.manifest.id)) {
        this.setEnabled(stored.manifest.id, stored.enabled);
      }
    }
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
      communication: this.communicationApi,
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
