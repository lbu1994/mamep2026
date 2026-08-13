/**
 * IndexedDB 工作区仓储（docs/TECH_DESIGN.md §19.3）。
 * 保存主工作区与一次备份；损坏时尝试从备份恢复；存储异常映射为结构化错误。
 */
import type { Result, Workspace } from "@mamep2026/domain";
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

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  async load(): Promise<Result<Workspace>> {
    try {
      const raw = await this.store.get(MAIN_KEY);
      if (raw === undefined) {
        return ok(createEmptyWorkspace());
      }
      const parsed = parseWorkspace(raw);
      if (parsed.ok) return parsed;

      // 损坏恢复：尝试读取备份。
      const backup = await this.store.get(BACKUP_KEY);
      if (backup !== undefined) {
        const backupParsed = parseWorkspace(backup);
        if (backupParsed.ok) return backupParsed;
      }
      return parsed;
    } catch (cause) {
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
}
