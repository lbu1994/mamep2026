/**
 * 删除 Electron 主进程 userData 下的工作区文件（ADR-036，2026-08-30）。
 *
 * 背景：Electron 工作区持久化已从 IndexedDB 改为主进程文件仓储（userData/workspace.json +
 * workspace.json.bak）。既有 e2e spec 在 beforeAll/beforeEach 里用
 * `indexedDB.deleteDatabase()` 清理工作区避免跨运行残留——该清理对文件仓储已失效，
 * 残留的 workspace.json 会在下次启动被加载（含前序测试写入的行/连接配置），污染弹窗
 * 与连接状态。故清理 IndexedDB 的同时必须删除工作区文件。
 */
import type { ElectronApplication } from "@playwright/test";
import { rm } from "node:fs/promises";
import path from "node:path";

export async function clearWorkspaceFile(
  app: ElectronApplication,
): Promise<void> {
  const userDataDir = await app.evaluate(async ({ app: electronApp }) =>
    electronApp.getPath("userData"),
  );
  await rm(path.join(userDataDir, "workspace.json"), { force: true });
  await rm(path.join(userDataDir, "workspace.json.bak"), { force: true });
}
