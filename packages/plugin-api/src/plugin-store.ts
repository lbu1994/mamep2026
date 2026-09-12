/**
 * 插件存储 Port 与数据契约（ADR-038，2026-08-30；ADR-039 2026-08-31：schemaVersion 1→2）。
 * 已安装插件（manifest + 启用状态）为应用级资产，非工作区数据；UI 不直接调用
 * IndexedDB/文件系统，只通过该接口访问。三端实现：
 * - 浏览器：IndexedDB KV（apps/web `IndexedDBPluginStore`，复用 createIdbKeyValueStore）；
 * - Electron：主进程 userData `plugins.json`（apps/electron `PluginFileStore`，原子保存 + .bak）；
 * - VSCode：Extension Host `context.globalState`。
 * 存储 schema 版本独立于工作区 schemaVersion / 消息协议版本。
 */
import { z } from "zod";
import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";
import { pluginManifestSchema, type PluginManifest } from "./manifest";

/**
 * 插件存储 schema 版本（v2：Manifest v2 字段，ADR-039；v3：随包插件一次性安装标记，
 * 2026-09-02 ADR-045；**v4：删除随包插件机制，2026-09-12 ADR-054**——所有插件一律由用户
 * 手动安装，插件记录新增 `executionMode`（安装时用户显式授权；缺省隔离执行），
 * 并在迁移时清空全部已安装插件（用户需重新安装）。
 */
export const PLUGIN_STORE_SCHEMA_VERSION = 4 as const;

/**
 * 插件执行模式（2026-09-12，ADR-054）：isolated=隔离线程执行（默认，Web Worker /
 * worker_threads）；same-process=与应用同进程执行（用户在安装确认框中显式授权后使用，
 * 用于贡献 codec/dataType/addressTransform 等**同步**能力）。
 */
export type PluginExecutionMode = "isolated" | "same-process";

export interface StoredPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  /** 单文件 JS 插件源码（ADR-044 Phase F-2）：可执行插件持久化用；纯清单插件无此字段。 */
  entrySource?: string | undefined;
  /** 执行模式（ADR-054）：无 entrySource（纯清单）时缺省；有执行面时必填。 */
  executionMode?: PluginExecutionMode | undefined;
}

export interface PluginStoreData {
  schemaVersion: typeof PLUGIN_STORE_SCHEMA_VERSION;
  plugins: StoredPlugin[];
}

/** 注册表快照（与 PluginStoreData 同构；ADR-054 起不再含 seeded 装配状态）。 */
export type PluginStoreSnapshot = Pick<
  PluginStoreData,
  "schemaVersion" | "plugins"
>;

/** 存储数据 Zod 校验（主进程/扩展宿主/测试在落盘前校验，与 manifest 校验一致）。 */
export const storedPluginSchema = z.object({
  manifest: pluginManifestSchema,
  enabled: z.boolean(),
  entrySource: z.string().optional(),
  executionMode: z.enum(["isolated", "same-process"]).optional(),
});
export const pluginStoreDataSchema = z.object({
  schemaVersion: z.literal(PLUGIN_STORE_SCHEMA_VERSION),
  plugins: z.array(storedPluginSchema),
});
export type StoredPluginZod = z.infer<typeof storedPluginSchema>;
export type PluginStoreDataZod = z.infer<typeof pluginStoreDataSchema>;

/** 空插件存储（首次启动 / 无已安装插件时 load 的兜底）。 */
export function createEmptyPluginStoreData(): PluginStoreData {
  return {
    schemaVersion: PLUGIN_STORE_SCHEMA_VERSION,
    plugins: [],
  };
}

/**
 * 存储数据迁移（ADR-039 / ADR-054）：
 * - schemaVersion 4（当前）：严格校验，损坏/非法 → PLUGIN_STORE_SCHEMA_INVALID；
 * - schemaVersion 1/2/3（历史，含随包插件机制）：**清空已安装插件**并升级到 v4
 *   （ADR-054：删除随包插件机制、插件一律手动安装，旧记录随机制废弃，用户需重新安装）；
 *   plugins 非数组视为损坏。
 */
export function migratePluginStoreData(
  input: unknown,
): Result<PluginStoreData> {
  if (typeof input !== "object" || input === null) {
    return fail(schemaInvalidError("plugin store data is not an object"));
  }
  const raw = input as { schemaVersion?: unknown; plugins?: unknown };
  if (raw.schemaVersion === PLUGIN_STORE_SCHEMA_VERSION) {
    const parsed = pluginStoreDataSchema.safeParse(input);
    if (!parsed.success) {
      return fail(
        schemaInvalidError(
          `stored plugin store is invalid: ${parsed.error.message}`,
        ),
      );
    }
    // 显式映射（exactOptionalPropertyTypes）：Zod optional 推断为必选属性 + undefined，
    // 映射回可选属性形态的 StoredPlugin。
    return ok({
      schemaVersion: parsed.data.schemaVersion,
      plugins: parsed.data.plugins.map((p) => ({
        manifest: p.manifest,
        enabled: p.enabled,
        ...(p.entrySource !== undefined ? { entrySource: p.entrySource } : {}),
        ...(p.executionMode !== undefined
          ? { executionMode: p.executionMode }
          : {}),
      })),
    });
  }
  if (!Array.isArray(raw.plugins)) {
    return fail(
      schemaInvalidError(
        "stored plugin store is invalid: plugins must be an array",
      ),
    );
  }
  // v1/v2/v3 → v4：清空已安装插件（ADR-054）。
  return ok(createEmptyPluginStoreData());
}

function schemaInvalidError(technicalMessage: string) {
  return createMamepError({
    code: "PLUGIN_STORE_SCHEMA_INVALID",
    category: "plugin",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.pluginStoreSchemaInvalid",
    technicalMessage,
  });
}

/** 插件存储 Port：实现由各平台 composition root / 主进程 / 扩展宿主提供。 */
export interface PluginStorePort {
  load(): Promise<Result<PluginStoreData>>;
  save(data: PluginStoreData): Promise<Result<void>>;
}
