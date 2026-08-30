/**
 * Electron 主进程插件文件仓储（ADR-038，2026-08-30）。
 * 实现 PluginStorePort：应用数据目录（app.getPath("userData")）下 plugins.json
 * （schemaVersion 1，结构对齐 plugin-api PluginStoreData）。原子保存 + 单份 .bak 轮转 +
 * 损坏从备份恢复自愈，与 WorkspaceFileRepository（ADR-036）同一模式；主文件缺失 = 首次
 * 启动返回空存储。路径与权限由主进程控制，Renderer 不直接触碰文件系统；跨边界经
 * HostMessage v1 plugin-store-load / plugin-store-save（载荷为结构化插件存储数据）。
 */
import { createMamepError } from "@mamep2026/domain";
import type { Result } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import type { PluginStoreData, PluginStorePort } from "@mamep2026/plugin-api";
import { createEmptyPluginStoreData, pluginStoreDataSchema } from "@mamep2026/plugin-api";
import { access, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

const MAIN_FILE = "plugins.json";
const BACKUP_FILE = "plugins.json.bak";
const TEMP_FILE = "plugins.json.tmp";

function pluginStoreError(code: string, technicalMessage: string, cause?: unknown) {
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class PluginFileStore implements PluginStorePort {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async load(): Promise<Result<PluginStoreData>> {
    const mainPath = path.join(this.dir, MAIN_FILE);
    const backupPath = path.join(this.dir, BACKUP_FILE);
    try {
      let raw: string;
      try {
        raw = await readFile(mainPath, "utf8");
      } catch (cause) {
        // 无主文件 = 首次启动：返回空存储（与浏览器 IndexedDB 一致）。
        if (isNodeError(cause) && cause.code === "ENOENT") {
          return ok(createEmptyPluginStoreData());
        }
        throw cause;
      }
      const parsed = this.parseStored(raw);
      if (parsed.ok) return parsed;

      // 损坏恢复：尝试读取备份。
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
          return backupParsed;
        }
      }
      // 主文件与备份皆不可用：返回主文件解析错误，UI 走既有错误提示路径。
      return parsed;
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

  private parseStored(raw: string): Result<PluginStoreData> {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return fail(
        createMamepError({
          code: "PLUGIN_STORE_SCHEMA_INVALID",
          category: "plugin",
          severity: "error",
          retryable: false,
          userMessageKey: "errors.pluginStoreSchemaInvalid",
          technicalMessage: "stored plugin store is not valid JSON",
        }),
      );
    }
    const parsed = pluginStoreDataSchema.safeParse(data);
    if (!parsed.success) {
      return fail(
        createMamepError({
          code: "PLUGIN_STORE_SCHEMA_INVALID",
          category: "plugin",
          severity: "error",
          retryable: false,
          userMessageKey: "errors.pluginStoreSchemaInvalid",
          technicalMessage: `stored plugin store is invalid: ${parsed.error.message}`,
        }),
      );
    }
    return ok(parsed.data);
  }

  async save(data: PluginStoreData): Promise<Result<void>> {
    try {
      // 落盘前校验（manifest 结构 + schemaVersion），非法数据不落盘。
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
      await this.writeAtomic(JSON.stringify(validated.data));
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

  /**
   * 原子写内容（对齐 WorkspaceFileRepository / TECH_DESIGN §19.4）：
   * 写临时文件 + fsync → 主文件轮转为 .bak → 临时文件替换为正式文件（Windows 兜底先删）。
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
