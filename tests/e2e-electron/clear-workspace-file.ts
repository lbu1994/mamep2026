/**
 * 删除 Electron 主进程 userData 下的工作区文件。
 *
 * Electron 工作区持久化使用主进程文件仓储（userData/workspace.json +
 * workspace.json.bak）。e2e 在清理 IndexedDB 的同时必须删除工作区文件，避免前序测试
 * 写入的行/连接配置跨运行残留。
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
