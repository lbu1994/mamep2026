/**
 * IndexedDB 工作区仓储（docs/TECH_DESIGN.md §19.3）。
 * 保存主工作区与一次备份；损坏时尝试从备份恢复；存储异常映射为结构化错误。
 */
import type {
  Result,
  Workspace,
  WorkspaceRecoveryInfo,
} from "@mamep2026/domain";
import { createEmptyWorkspace, createMamepError } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import type { WorkspaceRepositoryPort } from "@mamep2026/workspace";
import { parseWorkspace, serializeWorkspace } from "@mamep2026/workspace";
import { openDB } from "idb";

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** 用 idb 打开浏览器 IndexedDB，包装为简单键值存储。 */
export function createIdbKeyValueStore(dbName = "mamep2026"): KeyValueStore {
  const dbPromise = openDB(dbName, 1, {
    upgrade(db) {
      db.createObjectStore("kv");
    },
  });
  return {
    async get(key) {
      return (await dbPromise).get("kv", key);
    },
    async put(key, value) {
      await (await dbPromise).put("kv", value, key);
    },
    async delete(key) {
      await (await dbPromise).delete("kv", key);
    },
  };
}

const MAIN_KEY = "workspace";
const BACKUP_KEY = "workspace-backup";

function persistenceError(
  code: string,
  technicalMessage: string,
  cause?: unknown,
) {
  return createMamepError({
    code,
    category: "persistence",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.persistenceError",
    technicalMessage,
    cause,
  });
}

export class IndexedDBWorkspaceRepository implements WorkspaceRepositoryPort {
  private readonly store: KeyValueStore;
  /** 最近一次 `load()` 的恢复元数据（ADR-049）。 */
  private recoveryInfo: WorkspaceRecoveryInfo | null = null;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  async load(): Promise<Result<Workspace>> {
    try {
      const raw = await this.store.get(MAIN_KEY);
      if (raw === undefined) {
        // 首次启动（无持久化数据）：正常空工作区，不视为恢复。
        this.recoveryInfo = {
          recovered: false,
          source: "none",
          recoveredAt: Date.now(),
          backupTimestamp: null,
          errorCode: null,
        };
        return ok(createEmptyWorkspace());
      }
      const parsed = parseWorkspace(raw);
      if (parsed.ok) {
        this.recoveryInfo = {
          recovered: false,
          source: "none",
          recoveredAt: Date.now(),
          backupTimestamp: null,
          errorCode: null,
        };
        return parsed;
      }

      // 损坏恢复：尝试读取备份。
      const backup = await this.store.get(BACKUP_KEY);
      if (backup !== undefined) {
        const backupParsed = parseWorkspace(backup);
        if (backupParsed.ok) {
          this.recoveryInfo = {
            recovered: true,
            source: "backup",
            recoveredAt: Date.now(),
            backupTimestamp: null,
            errorCode: null,
          };
          return backupParsed;
        }
      }
      // 主与备份均不可用：以空工作区保持可操作，记录恢复失败来源。
      this.recoveryInfo = {
        recovered: true,
        source: "fresh",
        recoveredAt: Date.now(),
        backupTimestamp: null,
        errorCode: parsed.error.code ?? null,
      };
      return parsed;
    } catch (cause) {
      this.recoveryInfo = {
        recovered: true,
        source: "fresh",
        recoveredAt: Date.now(),
        backupTimestamp: null,
        errorCode: "PERSISTENCE_LOAD_FAILED",
      };
      return fail(
        persistenceError(
          "PERSISTENCE_LOAD_FAILED",
          cause instanceof Error ? cause.message : String(cause),
          cause,
        ),
      );
    }
  }

  async save(workspace: Workspace): Promise<Result<void>> {
    try {
      // 先轮转备份，再写主记录。
      const previous = await this.store.get(MAIN_KEY);
      if (previous !== undefined) {
        await this.store.put(BACKUP_KEY, previous);
      }
      await this.store.put(MAIN_KEY, JSON.parse(serializeWorkspace(workspace)));
      return ok(undefined);
    } catch (cause) {
      return fail(
        persistenceError(
          "PERSISTENCE_WRITE_FAILED",
          cause instanceof Error ? cause.message : String(cause),
          cause,
        ),
      );
    }
  }

  async clear(): Promise<Result<void>> {
    try {
      await this.store.delete(MAIN_KEY);
      await this.store.delete(BACKUP_KEY);
      return ok(undefined);
    } catch (cause) {
      return fail(
        persistenceError(
          "PERSISTENCE_CLEAR_FAILED",
          cause instanceof Error ? cause.message : String(cause),
          cause,
        ),
      );
    }
  }

  /** 重置为全新：清空主记录与备份（§19.1）。 */
  async reset(): Promise<Result<void>> {
    return this.clear();
  }

  /** 导出当前持久化工作区为序列化 JSON 字符串（§19.1；无数据时导出空工作区）。 */
  async export(): Promise<Result<string>> {
    try {
      const raw = await this.store.get(MAIN_KEY);
      if (raw === undefined)
        return ok(serializeWorkspace(createEmptyWorkspace()));
      const parsed = parseWorkspace(raw);
      if (!parsed.ok) return parsed;
      return ok(serializeWorkspace(parsed.value));
    } catch (cause) {
      return fail(
        persistenceError(
          "PERSISTENCE_EXPORT_FAILED",
          cause instanceof Error ? cause.message : String(cause),
          cause,
        ),
      );
    }
  }

  /** 导入工作区数据（parse + 校验后按 save() 同形态落盘，§19.1）。 */
  async import(serialized: string): Promise<Result<void>> {
    try {
      const parsed = parseWorkspace(JSON.parse(serialized));
      if (!parsed.ok) return parsed;
      await this.store.put(
        MAIN_KEY,
        JSON.parse(serializeWorkspace(parsed.value)),
      );
      return ok(undefined);
    } catch (cause) {
      return fail(
        persistenceError(
          "PERSISTENCE_IMPORT_FAILED",
          cause instanceof Error ? cause.message : String(cause),
          cause,
        ),
      );
    }
  }

  /** 创建当前工作区备份（主记录 → 备份轮转，§19.1）。 */
  async createBackup(): Promise<Result<void>> {
    try {
      const previous = await this.store.get(MAIN_KEY);
      if (previous !== undefined) {
        await this.store.put(BACKUP_KEY, previous);
      }
      return ok(undefined);
    } catch (cause) {
      return fail(
        persistenceError(
          "PERSISTENCE_WRITE_FAILED",
          cause instanceof Error ? cause.message : String(cause),
          cause,
        ),
      );
    }
  }

  /** 最近一次 `load()` 的恢复元数据（§19.1）。 */
  getRecoveryInfo(): WorkspaceRecoveryInfo | null {
    return this.recoveryInfo;
  }
}
