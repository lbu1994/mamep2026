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
import { recoveryPreview } from "@mamep2026/workspace";
import type { WorkspaceRepositoryPort } from "@mamep2026/workspace";
import { openDB } from "idb";
import {
  parseWorkspaceOffMainThread,
  parseWorkspaceTextOffMainThread,
  serializeWorkspaceOffMainThread,
} from "./workspace-parse-off-main";

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

/** Reject values JSON would silently drop or change; keep the stored original untouched. */
function originalText(value: unknown): string {
  return JSON.stringify(
    { missing: value === undefined, data: value ?? null },
    function (this: Record<string, unknown>, key: string, item: unknown) {
      const original = this[key];
      if (
        original === undefined ||
        typeof original === "bigint" ||
        typeof original === "function" ||
        typeof original === "symbol" ||
        (typeof original === "number" &&
          (!Number.isFinite(original) || Object.is(original, -0))) ||
        (typeof original === "object" &&
          original !== null &&
          !Array.isArray(original) &&
          Object.getPrototypeOf(original) !== Object.prototype &&
          Object.getPrototypeOf(original) !== null)
      ) {
        throw new Error(
          "The original record contains a value that JSON cannot preserve",
        );
      }
      return item;
    },
  );
}

export class IndexedDBWorkspaceRepository implements WorkspaceRepositoryPort {
  private readonly store: KeyValueStore;
  /** 最近一次 `load()` 的恢复元数据。 */
  private recoveryInfo: WorkspaceRecoveryInfo | null = null;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  private original: unknown = undefined;
  private originalExport: string | null = null;
  private candidate: { raw: unknown; workspace: Workspace } | null = null;
  private archiveKey: string | null = null;

  async load(): Promise<Result<Workspace>> {
    this.candidate = null;
    this.archiveKey = null;
    this.originalExport = null;
    this.recoveryInfo = {
      recovered: true,
      source: "fresh",
      pending: true,
      recoveredAt: Date.now(),
      backupTimestamp: null,
      errorCode: "PERSISTENCE_LOADING",
    };
    try {
      const raw = await this.store.get(MAIN_KEY);
      const parsed =
        raw === undefined ? null : await parseWorkspaceOffMainThread(raw);
      if (
        parsed?.ok ||
        (raw === undefined && (await this.store.get(BACKUP_KEY)) === undefined)
      ) {
        this.recoveryInfo = {
          recovered: false,
          source: "none",
          recoveredAt: Date.now(),
          backupTimestamp: null,
          errorCode: null,
        };
        return parsed ?? ok(createEmptyWorkspace());
      }
      this.original = structuredClone(raw);
      this.recoveryInfo = {
        recovered: true,
        source: "fresh",
        pending: true,
        recoveredAt: Date.now(),
        backupTimestamp: null,
        errorCode:
          parsed !== null && !parsed.ok
            ? parsed.error.code
            : "PERSISTENCE_MAIN_MISSING",
      };
      // Keep the stored value unchanged. IndexedDB records are objects, not file bytes.
      const sourceText = originalText(raw);
      this.originalExport = JSON.stringify(
        {
          version: 1,
          source: MAIN_KEY,
          capturedAt: this.recoveryInfo.recoveredAt,
          encoding: "json-value",
          missing: raw === undefined,
          data: raw ?? null,
        },
        null,
        2,
      );
      const bytes = new TextEncoder().encode(sourceText);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const id = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const archiveKey = `workspace-recovery-${id}`;
      if ((await this.store.get(archiveKey)) === undefined)
        await this.store.put(archiveKey, {
          version: 1,
          source: MAIN_KEY,
          capturedAt: this.recoveryInfo.recoveredAt,
          encoding: "json-value",
          missing: raw === undefined,
          data: this.original ?? null,
        });
      const archive: unknown = await this.store.get(archiveKey);
      if (
        typeof archive !== "object" ||
        archive === null ||
        !("data" in archive) ||
        originalText(
          "missing" in archive && archive.missing === true
            ? undefined
            : archive.data,
        ) !== originalText(this.original)
      )
        throw new Error("Recovery archive does not match the original");
      this.archiveKey = archiveKey;
      this.recoveryInfo.archiveId = archiveKey;
      const backupRaw = await this.store.get(BACKUP_KEY);
      if (backupRaw !== undefined) {
        const backup = await parseWorkspaceOffMainThread(backupRaw);
        if (backup.ok) {
          this.candidate = {
            raw: structuredClone(backupRaw),
            workspace: backup.value,
          };
          this.recoveryInfo.preview = recoveryPreview(backup.value);
        }
      }
      return ok(createEmptyWorkspace());
    } catch {
      this.recoveryInfo = {
        ...this.recoveryInfo,
        recovered: true,
        source: "fresh",
        pending: true,
        recoveredAt: Date.now(),
        backupTimestamp: null,
        errorCode: "PERSISTENCE_RECOVERY_PREPARE_FAILED",
      };
      return ok(createEmptyWorkspace());
    }
  }

  private blocked(): Result<never> {
    return fail(
      persistenceError(
        "PERSISTENCE_RECOVERY_PENDING",
        "Confirm recovery or reset before saving",
      ),
    );
  }

  /** Export the archived stored value and its source without workspace normalization. */
  async exportRecovery(): Promise<Result<string>> {
    try {
      if (this.archiveKey === null)
        return this.originalExport === null
          ? this.blocked()
          : ok(this.originalExport);
      const archive = await this.store.get(this.archiveKey);
      if (archive === undefined) throw new Error("Recovery archive is missing");
      originalText(archive);
      if (
        typeof archive !== "object" ||
        archive === null ||
        !("data" in archive) ||
        originalText(
          "missing" in archive && archive.missing === true
            ? undefined
            : archive.data,
        ) !== originalText(this.original)
      )
        throw new Error("Recovery archive changed");
      return ok(JSON.stringify(archive, null, 2));
    } catch (cause) {
      return fail(
        persistenceError(
          "PERSISTENCE_EXPORT_FAILED",
          "Could not export the original record",
          cause,
        ),
      );
    }
  }

  private async assertOriginalUnchanged(): Promise<void> {
    if (this.archiveKey === null)
      throw new Error("Recovery archive is unavailable");
    const archive: unknown = await this.store.get(this.archiveKey);
    if (
      typeof archive !== "object" ||
      archive === null ||
      !("data" in archive) ||
      originalText(
        "missing" in archive && archive.missing === true
          ? undefined
          : archive.data,
      ) !== originalText(this.original)
    )
      throw new Error("Recovery archive changed");
    const current = await this.store.get(MAIN_KEY);
    if (originalText(current) !== originalText(this.original))
      throw new Error("The source changed; reload the preview");
  }

  /** Apply a confirmed backup without rotating the damaged record over it. */
  async recover(): Promise<Result<Workspace>> {
    if (
      !this.recoveryInfo?.pending ||
      this.archiveKey === null ||
      this.candidate === null
    )
      return this.blocked();
    try {
      await this.assertOriginalUnchanged();
      const backup = await this.store.get(BACKUP_KEY);
      if (originalText(backup) !== originalText(this.candidate.raw))
        throw new Error("The backup changed; reload the preview");
      await this.store.put(MAIN_KEY, this.candidate.raw);
      this.recoveryInfo = {
        ...this.recoveryInfo,
        pending: false,
        source: "backup",
        errorCode: null,
        recoveredAt: Date.now(),
      };
      return ok(this.candidate.workspace);
    } catch (cause) {
      return fail(
        persistenceError(
          "PERSISTENCE_RECOVERY_FAILED",
          "Could not replace the damaged workspace",
          cause,
        ),
      );
    }
  }

  async save(workspace: Workspace): Promise<Result<void>> {
    if (this.recoveryInfo?.pending) return this.blocked();
    try {
      // 完整 Schema 校验与 JSON 转换在 Worker 中执行；此处只做 IndexedDB 写入。
      const serialized = await serializeWorkspaceOffMainThread(workspace);
      if (!serialized.ok) return serialized;
      if (this.recoveryInfo?.pending) return this.blocked();
      // 先轮转备份，再写主记录。
      const previous = await this.store.get(MAIN_KEY);
      if (previous !== undefined) {
        await this.store.put(BACKUP_KEY, previous);
      }
      await this.store.put(MAIN_KEY, serialized.value.data);
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
      if (this.recoveryInfo?.pending) {
        if (this.archiveKey === null) return this.blocked();
        await this.assertOriginalUnchanged();
      }
      await this.store.delete(MAIN_KEY);
      await this.store.delete(BACKUP_KEY);
      this.recoveryInfo = null;
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
      const workspace =
        raw === undefined
          ? ok(createEmptyWorkspace())
          : await parseWorkspaceOffMainThread(raw);
      if (!workspace.ok) return workspace;
      const serialized = await serializeWorkspaceOffMainThread(workspace.value);
      return serialized.ok ? ok(serialized.value.serialized) : serialized;
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
    if (this.recoveryInfo?.pending) return this.blocked();
    try {
      const parsed = await parseWorkspaceTextOffMainThread(serialized);
      if (!parsed.ok) return parsed;
      const normalized = await serializeWorkspaceOffMainThread(parsed.value);
      if (!normalized.ok) return normalized;
      await this.store.put(MAIN_KEY, normalized.value.data);
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
    if (this.recoveryInfo?.pending) return this.blocked();
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
