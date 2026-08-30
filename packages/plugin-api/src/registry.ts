/**
 * 插件注册表（浏览器 MVP：仅内置插件，清单驱动，启用/禁用，错误隔离）。
 * 平台能力过滤：浏览器不接受 node-only 插件；加载错误不阻止应用启动。
 * 来源标记（2026-08-30，ADR-038）：builtin=随应用构建的内置插件（不持久化），
 * installed=用户经安装入口注册的插件（持久化 manifest + 启用状态）。
 */
import { createMamepError, type Result } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import { pluginManifestSchema, type PluginManifest } from "./manifest";
import {
  PLUGIN_STORE_SCHEMA_VERSION,
  type PluginStoreData,
} from "./plugin-store";

/** 插件来源：builtin=内置（随应用构建，不持久化）；installed=用户安装（持久化）。 */
export type PluginSource = "builtin" | "installed";

export interface PluginLoadError {
  pluginId: string | null;
  errorCode: string;
  message: string;
}

export type PluginRegistryEvent =
  | { type: "registered"; pluginId: string }
  | { type: "enabled-changed"; pluginId: string; enabled: boolean };

interface RegisteredPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  source: PluginSource;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, RegisteredPlugin>();
  private readonly loadErrors: PluginLoadError[] = [];
  private readonly listeners = new Set<(event: PluginRegistryEvent) => void>();

  register(
    input: unknown,
    options?: { source?: PluginSource },
  ): Result<PluginManifest> {
    const source = options?.source ?? "builtin";
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

    this.plugins.set(manifest.id, { manifest, enabled: true, source });
    this.emit({ type: "registered", pluginId: manifest.id });
    return ok(manifest);
  }

  list(): PluginManifest[] {
    return [...this.plugins.values()].map((p) => p.manifest);
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
    this.emit({ type: "enabled-changed", pluginId, enabled });
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

  subscribe(listener: (event: PluginRegistryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: PluginRegistryEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
