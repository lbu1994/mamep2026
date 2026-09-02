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
import {
  PLUGIN_API_VERSION,
  pluginManifestSchema,
  type PluginManifest,
} from "./manifest";
import { normalizePermissions } from "./permissions";

/**
 * 插件存储 schema 版本（v2：Manifest v2 字段，ADR-039；
 * v3：随应用分发插件「一次性安装」标记，2026-09-02 插件外部化——首次启动时装配方
 * 自动安装随包插件（register + 持久化 manifest/启用状态），此后与用户安装插件完全等同
 * （含卸载=从存储删除、禁用=enabled 覆盖）；seeded=true 表示首次安装已完成，
 * 重启后不再自动安装（卸载持久生效），仅经 hydrate 恢复。
 */
export const PLUGIN_STORE_SCHEMA_VERSION = 3 as const;

export interface StoredPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  /** 单文件 JS 插件源码（ADR-044 Phase F-2）：可执行插件持久化用；纯清单插件无此字段。 */
  entrySource?: string;
}

export interface PluginStoreData {
  schemaVersion: typeof PLUGIN_STORE_SCHEMA_VERSION;
  plugins: StoredPlugin[];
  /** 随包插件首次自动安装是否已完成（2026-09-02 插件外部化）。 */
  seeded: boolean;
}

/** 存储数据 Zod 校验（主进程/扩展宿主/测试在落盘前校验，与 manifest 校验一致）。 */
export const storedPluginSchema = z.object({
  manifest: pluginManifestSchema,
  enabled: z.boolean(),
  entrySource: z.string().optional(),
});
export const pluginStoreDataSchema = z.object({
  schemaVersion: z.literal(PLUGIN_STORE_SCHEMA_VERSION),
  plugins: z.array(storedPluginSchema),
  seeded: z.boolean(),
});
export type StoredPluginZod = z.infer<typeof storedPluginSchema>;
export type PluginStoreDataZod = z.infer<typeof pluginStoreDataSchema>;

/** 空插件存储（首次启动 / 无已安装插件时 load 的兜底）。 */
export function createEmptyPluginStoreData(): PluginStoreData {
  return {
    schemaVersion: PLUGIN_STORE_SCHEMA_VERSION,
    plugins: [],
    seeded: false,
  };
}

/**
 * 存储数据迁移（ADR-039）：v1（manifest 无 apiVersion / requiredCapabilities、permissions 为
 * 自由 string[]）→ v2（Manifest v2 字段）。
 * - schemaVersion 2：严格校验（损坏/非法 → PLUGIN_STORE_SCHEMA_INVALID）；
 * - schemaVersion 1 / 缺失：迁移——plugins 必须为数组（否则视为损坏），非法条目跳过
 *   （不阻断其余条目），permissions 非法项丢弃。
 */
export function migratePluginStoreData(input: unknown): Result<PluginStoreData> {
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
      })),
      seeded: parsed.data.seeded,
    });
  }
  if (!Array.isArray(raw.plugins)) {
    return fail(
      schemaInvalidError("stored plugin store is invalid: plugins must be an array"),
    );
  }
  const migrated: StoredPlugin[] = [];
  for (const entry of raw.plugins) {
    if (typeof entry !== "object" || entry === null) continue;
    const stored = entry as { manifest?: unknown; enabled?: unknown };
    if (typeof stored.manifest !== "object" || stored.manifest === null) continue;
    const m = stored.manifest as Record<string, unknown>;
    const manifest: Record<string, unknown> = {
      ...m,
      apiVersion:
        typeof m.apiVersion === "string" && m.apiVersion.length > 0
          ? m.apiVersion
          : PLUGIN_API_VERSION,
      requiredCapabilities: Array.isArray(m.requiredCapabilities)
        ? m.requiredCapabilities
        : [],
      permissions: normalizePermissions(m.permissions),
      // 旧字段名 contributions（v1 固定 panels）与 v2 的 contributes 均兼容。
      contributes:
        typeof m.contributes === "object" && m.contributes !== null
          ? m.contributes
          : typeof m.contributions === "object" && m.contributions !== null
            ? m.contributions
            : {},
    };
    const parsed = pluginManifestSchema.safeParse(manifest);
    if (!parsed.success) continue;
    migrated.push({ manifest: parsed.data, enabled: stored.enabled === true });
  }
  // v2 → v3 迁移（2026-09-02 插件外部化）：旧数据无 seeded 标记，视为尚未执行随包插件
  // 一次性安装（升级后首次启动将自动安装随包插件）。
  return ok({
    schemaVersion: PLUGIN_STORE_SCHEMA_VERSION,
    plugins: migrated,
    seeded: false,
  });
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
