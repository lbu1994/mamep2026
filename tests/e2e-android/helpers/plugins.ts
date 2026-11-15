/**
 * Android 插件 e2e 助手。
 *
 * 提供「插件构建产物路径」（`pnpm build:plugins` 输出 `release/plugins/<pluginId>/`）与
 * 「插件存储直读」（IndexedDB `mamep2026` → 对象仓 `kv` → 键 `plugins`，与
 * `IndexedDBPluginStore` 同形，schemaVersion 4）——用于断言安装/卸载的**持久化**结果。
 *
 * 安装本身走真实 UI 路径（隐藏文件输入 + `setInputFiles`，见 `plugin-runtime.spec.ts`），
 * 不直接播种存储：播种会跳过安装流程，覆盖面反而更小。
 *
 * 注意：运行本套件前需先 `pnpm build:plugins`（根 `test:e2e:android` 已自动前置）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

/** 仓库根目录（本文件位于 tests/e2e-android/helpers/，上跳三级）。 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** 插件产物路径（`pnpm build:plugins` 输出，见 scripts/build-plugins.mjs）。 */
export function pluginArtifact(pluginId: string, fileName: string): string {
  return path.resolve(REPO_ROOT, "release/plugins", pluginId, fileName);
}

/** 读取插件清单（构建产物，与安装时用户选择的是同一份文件）。 */
export function pluginManifest(pluginId: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(pluginArtifact(pluginId, "manifest.json"), "utf8"),
  ) as Record<string, unknown>;
}

/** 读取插件存储（断言持久化用；无记录返回 null）。 */
export async function readPluginStore(page: Page): Promise<unknown> {
  return await page.evaluate(async () => {
    return await new Promise<unknown>((resolve) => {
      const request = indexedDB.open("mamep2026", 1);
      request.onerror = () => resolve(null);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("kv", "readonly");
        const get = tx.objectStore("kv").get("plugins");
        get.onsuccess = () => resolve(get.result ?? null);
        get.onerror = () => resolve(null);
      };
    });
  });
}
