/**
 * Electron 主进程工作区文件仓储（docs/TECH_DESIGN.md §19.4）。
 * 实现 WorkspaceRepositoryPort：应用数据目录（app.getPath("userData")）下版本化 JSON 文件。
 * 原子保存流程（§19.4）：序列化 → 写临时文件 → 写入完成 → 尽可能同步刷新（fsync）→
 * 当前文件轮转为备份 → 临时文件原子替换为正式文件；单份 .bak 轮转（与浏览器
 * IndexedDBWorkspaceRepository 的单备份语义一致）。损坏时先归档原文，再等待用户确认恢复。
 * 路径与权限由主进程控制，Renderer 不直接触碰文件系统；跨边界经 HostMessage v2
 * workspace-load / workspace-save / workspace-clear（content 传序列化 JSON 字符串）。
 */
import { createEmptyWorkspace, createMamepError } from "@mamep2026/domain";
import type {
  Result,
  Workspace,
  WorkspaceRecoveryInfo,
} from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import type { WorkspaceRepositoryPort } from "@mamep2026/workspace";
import {
  parseWorkspace,
  serializeWorkspace,
  recoveryPreview,
} from "@mamep2026/workspace";
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const MAIN_FILE = "workspace.json";
const BACKUP_FILE = "workspace.json.bak";
const TEMP_FILE = "workspace.json.tmp";

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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** 读取文件修改时间戳（ms）；文件不存在/不可读时返回 null（恢复备份时间）。 */
async function fileMtime(filePath: string): Promise<number | null> {
  try {
    const s = await stat(filePath);
    return s.mtimeMs;
  } catch {
    return null;
  }
}

export class WorkspaceFileRepository implements WorkspaceRepositoryPort {
  private readonly dir: string;
  /** 最近一次 `load()` 的恢复元数据。 */
  private recoveryInfo: WorkspaceRecoveryInfo | null = null;

  constructor(dir: string) {
    this.dir = dir;
  }

  private original: Buffer | null = null;
  private originalExport: string | null = null;
  private candidate: { raw: Buffer; workspace: Workspace } | null = null;
  private archivePath: string | null = null;

  async load(): Promise<Result<Workspace>> {
    const mainPath = path.join(this.dir, MAIN_FILE);
    const backupPath = path.join(this.dir, BACKUP_FILE);
    this.candidate = null;
    this.archivePath = null;
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
      let raw: Buffer | null = null;
      try {
        raw = await readFile(mainPath);
      } catch (cause) {
        if (!isNodeError(cause) || cause.code !== "ENOENT") throw cause;
      }
      const parsed =
        raw === null ? null : this.parseStored(raw.toString("utf8"));
      if (parsed?.ok || (raw === null && !(await fileExists(backupPath)))) {
        this.recoveryInfo = {
          recovered: false,
          source: "none",
          recoveredAt: Date.now(),
          backupTimestamp: null,
          errorCode: null,
        };
        return parsed ?? ok(createEmptyWorkspace());
      }

      // Block every write before archiving or inspecting a backup.
      this.original = raw;
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
      const archive = JSON.stringify(
        {
          version: 1,
          source: mainPath,
          capturedAt: this.recoveryInfo.recoveredAt,
          encoding: "base64",
          data: raw?.toString("base64") ?? null,
        },
        null,
        2,
      );
      this.originalExport = archive;
      const digest = createHash("sha256")
        .update(raw === null ? "missing:" : "present:")
        .update(raw ?? "")
        .digest("hex");
      const archiveDir = path.join(this.dir, "workspace-recovery");
      await mkdir(archiveDir, { recursive: true });
      const archivePath = path.join(archiveDir, `${digest}.json`);
      try {
        const handle = await open(archivePath, "wx", 0o444);
        try {
          await handle.writeFile(archive, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
      } catch (cause) {
        if (!isNodeError(cause) || cause.code !== "EEXIST") throw cause;
      }
      // Reopening an existing archive must never accept an incomplete prior write.
      const archived: unknown = JSON.parse(await readFile(archivePath, "utf8"));
      if (
        typeof archived !== "object" ||
        archived === null ||
        !("data" in archived) ||
        archived.data !== (raw?.toString("base64") ?? null)
      ) {
        throw new Error(
          "The recovery archive does not match the original bytes",
        );
      }
      this.archivePath = archivePath;
      this.recoveryInfo.archiveId = path.basename(archivePath);
      try {
        const backupRaw = await readFile(backupPath);
        const backup = this.parseStored(backupRaw.toString("utf8"));
        if (backup.ok) {
          this.candidate = { raw: backupRaw, workspace: backup.value };
          this.recoveryInfo.preview = recoveryPreview(backup.value);
          this.recoveryInfo.backupTimestamp = await fileMtime(backupPath);
        }
      } catch (cause) {
        if (!isNodeError(cause) || cause.code !== "ENOENT") throw cause;
      }
      // Keep the backup out of the live workspace until the user confirms.
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

  /** Export exact source bytes and provenance, even when JSON parsing failed. */
  async exportRecovery(): Promise<Result<string>> {
    try {
      if (this.archivePath === null)
        return this.originalExport === null
          ? this.blocked()
          : ok(this.originalExport);
      const content = await readFile(this.archivePath, "utf8");
      const archive: unknown = JSON.parse(content);
      if (
        typeof archive !== "object" ||
        archive === null ||
        !("data" in archive) ||
        archive.data !== (this.original?.toString("base64") ?? null)
      )
        throw new Error("Recovery archive changed");
      return ok(content);
    } catch (cause) {
      return fail(
        persistenceError(
          "PERSISTENCE_EXPORT_FAILED",
          "Could not read the recovery archive",
          cause,
        ),
      );
    }
  }

  /** Replace only the unchanged damaged source; preserve the validated backup. */
  async recover(): Promise<Result<Workspace>> {
    if (
      !this.recoveryInfo?.pending ||
      this.archivePath === null ||
      this.candidate === null
    )
      return this.blocked();
    try {
      await this.assertOriginalUnchanged();
      const backup = await readFile(path.join(this.dir, BACKUP_FILE));
      if (!backup.equals(this.candidate.raw))
        throw new Error("The backup changed; reload the preview");
      await this.writeAtomic(this.candidate.raw.toString("utf8"), false);
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

  private async assertOriginalUnchanged(): Promise<void> {
    if (this.archivePath === null)
      throw new Error("Recovery archive is unavailable");
    const archive: unknown = JSON.parse(
      await readFile(this.archivePath, "utf8"),
    );
    if (
      typeof archive !== "object" ||
      archive === null ||
      !("data" in archive) ||
      archive.data !== (this.original?.toString("base64") ?? null)
    )
      throw new Error("Recovery archive changed");
    let current: Buffer | null = null;
    try {
      current = await readFile(path.join(this.dir, MAIN_FILE));
    } catch (cause) {
      if (!isNodeError(cause) || cause.code !== "ENOENT") throw cause;
    }
    if (
      current === null
        ? this.original !== null
        : this.original === null || !current.equals(this.original)
    ) {
      throw new Error("The source changed; reload the recovery preview");
    }
  }

  /**
   * 解析存储内容：文件内容为 serializeWorkspace 序列化的 JSON 字符串，
   * parseWorkspace 接收对象，故先 JSON.parse（非法 JSON = 损坏，返回结构化错误，
   * 调用方据此尝试备份恢复）。
   */
  private parseStored(raw: string): Result<Workspace> {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return fail(
        createMamepError({
          code: "WORKSPACE_SCHEMA_INVALID",
          category: "persistence",
          severity: "error",
          retryable: false,
          userMessageKey: "errors.workspaceSchemaInvalid",
          technicalMessage: "stored workspace is not valid JSON",
        }),
      );
    }
    return parseWorkspace(data);
  }

  async save(workspace: Workspace): Promise<Result<void>> {
    if (this.recoveryInfo?.pending) return this.blocked();
    try {
      await this.writeAtomic(serializeWorkspace(workspace));
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
        if (this.archivePath === null) return this.blocked();
        await this.assertOriginalUnchanged();
      }
      await rm(path.join(this.dir, MAIN_FILE), { force: true });
      await rm(path.join(this.dir, BACKUP_FILE), { force: true });
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

  /** 重置为全新：删除主文件与备份（§19.1）。 */
  async reset(): Promise<Result<void>> {
    return this.clear();
  }

  /** 导出当前持久化工作区（主文件当前内容；无文件 = 空工作区序列化，§19.1）。 */
  async export(): Promise<Result<string>> {
    try {
      const mainPath = path.join(this.dir, MAIN_FILE);
      try {
        return ok(await readFile(mainPath, "utf8"));
      } catch (cause) {
        if (isNodeError(cause) && cause.code === "ENOENT") {
          return ok(serializeWorkspace(createEmptyWorkspace()));
        }
        throw cause;
      }
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

  /** 导入工作区数据（parse + 校验后原子落盘，§19.1）。 */
  async import(serialized: string): Promise<Result<void>> {
    if (this.recoveryInfo?.pending) return this.blocked();
    try {
      const parsed = this.parseStored(serialized);
      if (!parsed.ok) return parsed;
      await this.writeAtomic(serialized);
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

  /** 创建当前工作区文件备份（主文件→.bak 轮转；无主文件时 no-op 成功，§19.1）。 */
  async createBackup(): Promise<Result<void>> {
    if (this.recoveryInfo?.pending) return this.blocked();
    try {
      const mainPath = path.join(this.dir, MAIN_FILE);
      const backupPath = path.join(this.dir, BACKUP_FILE);
      if (await fileExists(mainPath)) {
        await rm(backupPath, { force: true });
        await rename(mainPath, backupPath);
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

  /**
   * 原子写内容（TECH_DESIGN §19.4）：
   * 1) 写同目录临时文件并 fsync（尽可能同步刷新）；
   * 2) 主文件存在则轮转为备份（先删旧 .bak 再 rename，规避 Windows rename 目标已存在失败）；
   * 3) 临时文件替换为正式文件（Windows 下先删主再 rename 的兜底记录）。
   */
  private async writeAtomic(
    content: string,
    rotateBackup = true,
  ): Promise<void> {
    const mainPath = path.join(this.dir, MAIN_FILE);
    const backupPath = path.join(this.dir, BACKUP_FILE);
    const tempPath = path.join(this.dir, TEMP_FILE);
    try {
      const handle = await open(tempPath, "w");
      try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (rotateBackup && (await fileExists(mainPath))) {
        await rm(backupPath, { force: true });
        await rename(mainPath, backupPath);
      }
      if (rotateBackup) await rm(mainPath, { force: true });
      await rename(tempPath, mainPath);
    } catch (cause) {
      // 清理残留临时文件（尽力而为，避免脏文件残留）。
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw cause;
    }
  }
}

function isNodeError(cause: unknown): cause is NodeJS.ErrnoException {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof (cause as { code?: unknown }).code === "string"
  );
}
