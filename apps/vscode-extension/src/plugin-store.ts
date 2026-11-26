/**
 * Persist v5 plugin records in Extension Host globalState.
 * Validate each snapshot and write accepted snapshots in call order.
 * Reads wait for pending saves. Write failures return a plugin error and do
 * not block later saves. This store does not contain workspace data.
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
/** Bound concurrent save requests while a globalState update is pending. */
const MAX_PENDING_PLUGIN_SAVES = 32;

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
  private pendingWrite: Promise<void> = Promise.resolve();
  private pendingSaveCount = 0;

  constructor(memento: KeyValueMemento) {
    this.memento = memento;
  }

  async load(): Promise<Result<PluginStoreData>> {
    // Read only after saves already accepted by this adapter have settled.
    await this.pendingWrite;
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
    if (this.pendingSaveCount >= MAX_PENDING_PLUGIN_SAVES) {
      return fail(
        createMamepError({
          code: "PLUGIN_STORE_WRITE_FAILED",
          category: "plugin",
          severity: "error",
          retryable: true,
          userMessageKey: "errors.pluginStoreError",
          technicalMessage: "too many pending plugin saves",
        }),
      );
    }
    // Memento change events can replace its cached value while another update
    // is pending. Wait for each update before submitting the next snapshot.
    this.pendingSaveCount += 1;
    const write = this.pendingWrite.then(async (): Promise<Result<void>> => {
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
      } finally {
        this.pendingSaveCount -= 1;
      }
    });
    // A rejected write returns its error to the caller without blocking later saves.
    this.pendingWrite = write.then(() => undefined);
    return write;
  }
}
