/**
 * 插件存储 Port 与数据契约。
 * 已安装插件（manifest + 启用状态）为应用级资产，非工作区数据；UI 不直接调用
 * IndexedDB/文件系统，只通过该接口访问。三端实现：
 * - 浏览器：IndexedDB KV（apps/web `IndexedDBPluginStore`，复用 createIdbKeyValueStore）；
 * - Electron：主进程 userData `plugins.json`（apps/electron `PluginFileStore`，原子保存 + .bak）；
 * - VSCode：Extension Host `context.globalState`。
 * 存储 schema 版本独立于工作区 schemaVersion / 消息协议版本。
 */
import { z } from "zod";
import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";
import { pluginApprovalSchema, type PluginApproval } from "./plugin-approval";
import { pluginManifestSchema, type PluginManifest } from "./manifest";

/** Store v5 adds content-bound consent. Migration preserves v4 source without granting access. */
export const PLUGIN_STORE_SCHEMA_VERSION = 5 as const;

/**
 * 插件执行模式：isolated=隔离线程执行（默认，Web Worker /
 * worker_threads）；same-process=与应用同进程执行（用户在安装确认框中显式授权后使用，
 * 用于贡献 codec/dataType/addressTransform 等**同步**能力）。
 */
export type PluginExecutionMode = "isolated" | "same-process";

export interface StoredPlugin {
  /** User-approved content. Missing records require confirmation before execution. */
  approval?: PluginApproval | undefined;
  manifest: PluginManifest;
  enabled: boolean;
  /** 单文件 JS 插件源码：可执行插件持久化用；纯清单插件无此字段。 */
  entrySource?: string | undefined;
  /** 执行模式：无 entrySource（纯清单）时缺省；有执行面时必填。 */
  executionMode?: PluginExecutionMode | undefined;
}

export interface PluginStoreData {
  schemaVersion: typeof PLUGIN_STORE_SCHEMA_VERSION;
  plugins: StoredPlugin[];
}

/** 注册表快照（与 PluginStoreData 同构起不再含 seeded 装配状态）。 */
export type PluginStoreSnapshot = Pick<
  PluginStoreData,
  "schemaVersion" | "plugins"
>;

/** 存储数据 Zod 校验（主进程/扩展宿主/测试在落盘前校验，与 manifest 校验一致）。 */
export const storedPluginSchema = z.object({
  approval: pluginApprovalSchema.optional(),
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

/** Validate v5, retain disabled v4 executables, and preserve the legacy v1-v3 empty-store migration. */
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
        ...(p.approval !== undefined ? { approval: p.approval } : {}),
        ...(p.entrySource !== undefined ? { entrySource: p.entrySource } : {}),
        ...(p.executionMode !== undefined
          ? { executionMode: p.executionMode }
          : {}),
      })),
    });
  }
  // Preserve v4 source and settings without inferring consent from a manifest.
  if (raw.schemaVersion === 4) {
    const legacy = z
      .object({
        schemaVersion: z.literal(4),
        plugins: z.array(storedPluginSchema.omit({ approval: true })),
      })
      .safeParse(input);
    if (!legacy.success) return fail(schemaInvalidError(legacy.error.message));
    return ok({
      schemaVersion: PLUGIN_STORE_SCHEMA_VERSION,
      plugins: legacy.data.plugins.map((plugin) => ({
        ...plugin,
        enabled: plugin.entrySource === undefined ? plugin.enabled : false,
      })),
    });
  }
  if (
    raw.schemaVersion !== 1 &&
    raw.schemaVersion !== 2 &&
    raw.schemaVersion !== 3
  ) {
    return fail(schemaInvalidError("unsupported plugin store version"));
  }
  if (!Array.isArray(raw.plugins)) {
    return fail(
      schemaInvalidError(
        "stored plugin store is invalid: plugins must be an array",
      ),
    );
  }
  // Preserve the existing empty-store migration for v1-v3.
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
