/**
 * VSCode 扩展宿主插件存储。
 * 实现 PluginStorePort：context.globalState 承载（应用级持久化，跨窗口共享，非工作区数据）。
 * 与主进程 plugins.json / 浏览器 IndexedDB 存储语义一致：schemaVersion 1 + installed 插件
 * 清单 + 启用状态；load/save 均经 pluginStoreDataSchema 校验，损坏数据返回结构化错误
 * （category plugin），不污染既有状态。
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

/** globalState 最小形状（context.globalState 满足；测试注入 fake，避免依赖 vscode 类型）。 */
export interface KeyValueMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

const STORE_KEY = "mamep2026.plugins";

function schemaInvalidError(
  technicalMessage: string,
): ReturnType<typeof createMamepError> {
  return createMamepError({
    code: "PLUGIN_STORE_SCHEMA_INVALID",
    category: "plugin",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.pluginStoreSchemaInvalid",
    technicalMessage,
  });
}

export class GlobalStatePluginStore implements PluginStorePort {
  private readonly memento: KeyValueMemento;

  constructor(memento: KeyValueMemento) {
    this.memento = memento;
  }

  async load(): Promise<Result<PluginStoreData>> {
    const raw = this.memento.get<unknown>(STORE_KEY);
    if (raw === undefined) return ok(createEmptyPluginStoreData());
    // v1 → v2 迁移：老版本已装插件平滑升级；损坏数据返回结构化错误。
    return migratePluginStoreData(raw);
  }

  async save(data: PluginStoreData): Promise<Result<void>> {
    const validated = pluginStoreDataSchema.safeParse(data);
    if (!validated.success) {
      return fail(
        schemaInvalidError(
          `plugin store data is invalid: ${validated.error.message}`,
        ),
      );
    }
    try {
      await this.memento.update(STORE_KEY, validated.data);
      return ok(undefined);
    } catch (cause) {
      return fail(
        createMamepError({
          code: "PLUGIN_STORE_WRITE_FAILED",
          category: "plugin",
          severity: "error",
          retryable: false,
          userMessageKey: "errors.pluginStoreError",
          technicalMessage:
            cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
      );
    }
  }
}
