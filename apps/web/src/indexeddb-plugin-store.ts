/**
 * 浏览器插件存储（ADR-038，2026-08-30）。
 * 实现 PluginStorePort：IndexedDB KV（createIdbKeyValueStore，与工作区仓储同一
 * 键值库，独立 key "plugins"）。存储语义与主进程 plugins.json / VSCode globalState
 * 一致：schemaVersion 1 + installed 插件清单 + 启用状态；load/save 均经
 * pluginStoreDataSchema 校验，损坏数据返回结构化错误（category plugin）。
 */
import { createMamepError } from "@mamep2026/domain";
import type { Result } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import type { PluginStoreData, PluginStorePort } from "@mamep2026/plugin-api";
import {
  createEmptyPluginStoreData,
  migratePluginStoreData,
  pluginStoreDataSchema,
} from "@mamep2026/plugin-api";
import type { KeyValueStore } from "@mamep2026/platform-web";

const PLUGINS_KEY = "plugins";

function pluginStoreError(
  code: string,
  technicalMessage: string,
  cause?: unknown,
) {
  return createMamepError({
    code,
    category: "plugin",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.pluginStoreError",
    technicalMessage,
    cause,
  });
}

export class IndexedDBPluginStore implements PluginStorePort {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  async load(): Promise<Result<PluginStoreData>> {
    try {
      const raw = await this.store.get(PLUGINS_KEY);
      if (raw === undefined) return ok(createEmptyPluginStoreData());
      // v1 → v2 迁移（ADR-039）：老版本已装插件平滑升级；损坏数据返回结构化错误。
      return migratePluginStoreData(raw);
    } catch (cause) {
      return fail(
        pluginStoreError(
          "PLUGIN_STORE_LOAD_FAILED",
          cause instanceof Error ? cause.message : String(cause),
          cause,
        ),
      );
    }
  }

  async save(data: PluginStoreData): Promise<Result<void>> {
    try {
      const validated = pluginStoreDataSchema.safeParse(data);
      if (!validated.success) {
        return fail(
          createMamepError({
            code: "PLUGIN_STORE_SCHEMA_INVALID",
            category: "plugin",
            severity: "error",
            retryable: false,
            userMessageKey: "errors.pluginStoreSchemaInvalid",
            technicalMessage: `plugin store data is invalid: ${validated.error.message}`,
          }),
        );
      }
      await this.store.put(PLUGINS_KEY, validated.data);
      return ok(undefined);
    } catch (cause) {
      return fail(
        pluginStoreError(
          "PLUGIN_STORE_WRITE_FAILED",
          cause instanceof Error ? cause.message : String(cause),
          cause,
        ),
      );
    }
  }
}
