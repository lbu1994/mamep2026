/**
 * 插件注册表（浏览器 MVP：仅内置插件，清单驱动，启用/禁用，错误隔离）。
 * 平台能力过滤：浏览器不接受 node-only 插件；加载错误不阻止应用启动。
 */
import { createMamepError, type Result } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import { pluginManifestSchema, type PluginManifest } from "./manifest";

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
}

export class PluginRegistry {
  private readonly plugins = new Map<string, RegisteredPlugin>();
  private readonly loadErrors: PluginLoadError[] = [];
  private readonly listeners = new Set<(event: PluginRegistryEvent) => void>();

  register(input: unknown): Result<PluginManifest> {
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

    this.plugins.set(manifest.id, { manifest, enabled: true });
    this.emit({ type: "registered", pluginId: manifest.id });
    return ok(manifest);
  }

  list(): PluginManifest[] {
    return [...this.plugins.values()].map((p) => p.manifest);
  }

  isEnabled(pluginId: string): boolean {
    return this.plugins.get(pluginId)?.enabled ?? false;
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    const plugin = this.plugins.get(pluginId);
    if (plugin === undefined || plugin.enabled === enabled) return;
    plugin.enabled = enabled;
    this.emit({ type: "enabled-changed", pluginId, enabled });
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
