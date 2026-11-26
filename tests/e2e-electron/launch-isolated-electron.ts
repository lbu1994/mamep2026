import { _electron, type ElectronApplication } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 启动使用独立 userData 目录的 Electron 生产构建。
 *
 * 真实端口 spec 会切换行数据类型并安装插件；若复用默认 userData，spec 间和重复运行间会
 * 通过工作区/插件持久化互相污染。启动后再删文件存在 autosave 竞态，因此必须在启动前隔离。
 */
export async function launchIsolatedElectron(options: {
  executablePath: string;
  mainEntry: string;
  cwd: string;
}): Promise<{
  app: ElectronApplication;
  userDataDir: string;
}> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "mamep-electron-e2e-"));
  try {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE")
        env[key] = value;
    }
    const app = await _electron.launch({
      executablePath: options.executablePath,
      args: [options.mainEntry, `--user-data-dir=${userDataDir}`],
      cwd: options.cwd,
      env,
    });
    return { app, userDataDir };
  } catch (error) {
    await rm(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

export async function closeIsolatedElectron(
  app: ElectronApplication | undefined,
  userDataDir: string | undefined,
): Promise<void> {
  try {
    await app?.close();
  } catch {
    // 已关闭。
  } finally {
    if (userDataDir !== undefined) {
      await rm(userDataDir, { recursive: true, force: true });
    }
  }
}
