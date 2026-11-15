/**
 * Electron 主进程工作区文件仓储（docs/TECH_DESIGN.md §19.4）。
 * 实现 WorkspaceRepositoryPort：应用数据目录（app.getPath("userData")）下版本化 JSON 文件。
 * 原子保存流程（§19.4）：序列化 → 写临时文件 → 写入完成 → 尽可能同步刷新（fsync）→
 * 当前文件轮转为备份 → 临时文件原子替换为正式文件；单份 .bak 轮转（与浏览器
 * IndexedDBWorkspaceRepository 的单备份语义一致）。损坏时尝试从备份恢复（自愈写回）。
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
import { parseWorkspace, serializeWorkspace } from "@mamep2026/workspace";
import { access, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

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

  async load(): Promise<Result<Workspace>> {
    const mainPath = path.join(this.dir, MAIN_FILE);
    const backupPath = path.join(this.dir, BACKUP_FILE);
    try {
      let raw: string;
      try {
        raw = await readFile(mainPath, "utf8");
      } catch (cause) {
        // 无主文件 = 首次启动：返回空工作区（与浏览器 IndexedDB 一致）。
        if (isNodeError(cause) && cause.code === "ENOENT") {
          this.recoveryInfo = {
            recovered: false,
            source: "none",
            recoveredAt: Date.now(),
            backupTimestamp: null,
            errorCode: null,
          };
          return ok(createEmptyWorkspace());
        }
        throw cause;
      }
      const parsed = this.parseStored(raw);
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

      // 损坏恢复：尝试读取备份（docs/AGENTS.md §19.6）。
      let backupRaw: string | undefined;
      try {
        backupRaw = await readFile(backupPath, "utf8");
      } catch {
        backupRaw = undefined;
      }
      if (backupRaw !== undefined) {
        const backupParsed = this.parseStored(backupRaw);
        if (backupParsed.ok) {
          // 自愈：把备份内容写回主文件（尽力而为，失败不影响本次返回）。
          await this.writeAtomic(backupRaw).catch(() => undefined);
          this.recoveryInfo = {
            recovered: true,
            source: "backup",
            recoveredAt: Date.now(),
            backupTimestamp: await fileMtime(backupPath),
            errorCode: null,
          };
          return backupParsed;
        }
      }
      // 主文件与备份皆不可用：返回主文件解析错误，UI 走既有加载失败路径。
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
      await rm(path.join(this.dir, MAIN_FILE), { force: true });
      await rm(path.join(this.dir, BACKUP_FILE), { force: true });
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
  private async writeAtomic(content: string): Promise<void> {
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
      if (await fileExists(mainPath)) {
        await rm(backupPath, { force: true });
        await rename(mainPath, backupPath);
      }
      await rm(mainPath, { force: true });
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
