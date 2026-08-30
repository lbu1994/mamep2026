/**
 * 插件存储 Port 与数据契约（ADR-038，2026-08-30）。
 * 已安装插件（manifest + 启用状态）为应用级资产，非工作区数据；UI 不直接调用
 * IndexedDB/文件系统，只通过该接口访问。三端实现：
 * - 浏览器：IndexedDB KV（apps/web `IndexedDBPluginStore`，复用 createIdbKeyValueStore）；
 * - Electron：主进程 userData `plugins.json`（apps/electron `PluginFileStore`，原子保存 + .bak）；
 * - VSCode：Extension Host `context.globalState`。
 * 存储 schema 版本独立于工作区 schemaVersion / 消息协议版本。
 */
import { z } from "zod";
import type { Result } from "@mamep2026/domain";
import { pluginManifestSchema, type PluginManifest } from "./manifest";

/** 插件存储 schema 版本（当前仅 v1：installed 插件清单 + 启用状态）。 */
export const PLUGIN_STORE_SCHEMA_VERSION = 1 as const;

export interface StoredPlugin {
  manifest: PluginManifest;
  enabled: boolean;
}

export interface PluginStoreData {
  schemaVersion: typeof PLUGIN_STORE_SCHEMA_VERSION;
  plugins: StoredPlugin[];
}

/** 存储数据 Zod 校验（主进程/扩展宿主/测试在落盘前校验，与 manifest 校验一致）。 */
export const storedPluginSchema = z.object({
  manifest: pluginManifestSchema,
  enabled: z.boolean(),
});
export const pluginStoreDataSchema = z.object({
  schemaVersion: z.literal(PLUGIN_STORE_SCHEMA_VERSION),
  plugins: z.array(storedPluginSchema),
});
export type StoredPluginZod = z.infer<typeof storedPluginSchema>;
export type PluginStoreDataZod = z.infer<typeof pluginStoreDataSchema>;

/** 空插件存储（首次启动 / 无已安装插件时 load 的兜底）。 */
export function createEmptyPluginStoreData(): PluginStoreData {
  return { schemaVersion: PLUGIN_STORE_SCHEMA_VERSION, plugins: [] };
}

/** 插件存储 Port：实现由各平台 composition root / 主进程 / 扩展宿主提供。 */
export interface PluginStorePort {
  load(): Promise<Result<PluginStoreData>>;
  save(data: PluginStoreData): Promise<Result<void>>;
}
