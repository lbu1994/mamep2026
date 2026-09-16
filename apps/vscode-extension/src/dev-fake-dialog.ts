/**
 * dev/e2e 假文件对话框（MAMEP_FAKE_DIALOG=1 && isDev 门控，不进生产打包路径）。
 *
 * 系统文件对话框无法被测试桩替换：@vscode/test-electron 的测试宿主与扩展宿主为不同进程，
 * vscode.window.showSaveDialog/showOpenDialog 在测试内桩替换对扩展不生效（ADR-033 验证）。
 * 故与 MAMEP_FAKE_SERIAL / MAMEP_FAKE_TCP 同模式：扩展宿主在 isDev 门控下把 save/open
 * 对话框替换为对固定路径的读写，使 e2e 能确定性走通「真实 RPC → 扩展宿主对话框边界 →
 * workspace.fs 真实读写」闭环。
 *
 * 使用：`MAMEP_FAKE_DIALOG=1` 时 extension.ts 的 saveTextFile/openTextFile 走本模块；
 * 路径可用环境变量覆盖（MAMEP_FAKE_DIALOG_SAVE_PATH / MAMEP_FAKE_DIALOG_OPEN_PATH，
 * run-e2e.mjs 注入，测试用例读取同一变量定位文件），缺省为 os.tmpdir() 下约定文件名。
 * 打开文件不存在 = 用户取消（content:null，非错误，语义与真实对话框一致）。
 */
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";
import type {
  OpenTextFileResponse,
  SaveTextFileResponse,
} from "@mamep2026/platform-api";

/** 环境变量名（run-e2e.mjs 注入；测试用例读取同一变量以定位文件）。 */
export const MAMEP_FAKE_DIALOG_OPEN_PATH_ENV = "MAMEP_FAKE_DIALOG_OPEN_PATH";
export const MAMEP_FAKE_DIALOG_SAVE_PATH_ENV = "MAMEP_FAKE_DIALOG_SAVE_PATH";

/** 缺省约定路径（未显式设置环境变量时）。 */
export function defaultFakeDialogPaths(): {
  openPath: string;
  savePath: string;
} {
  return {
    openPath: path.join(tmpdir(), "mamep-fake-dialog-open.json"),
    savePath: path.join(tmpdir(), "mamep-fake-dialog-save.json"),
  };
}

/** 解析 fake 对话框路径（环境变量覆盖 > 缺省约定路径）。 */
export function fakeDialogPaths(): { openPath: string; savePath: string } {
  const defaults = defaultFakeDialogPaths();
  return {
    openPath: process.env[MAMEP_FAKE_DIALOG_OPEN_PATH_ENV] ?? defaults.openPath,
    savePath: process.env[MAMEP_FAKE_DIALOG_SAVE_PATH_ENV] ?? defaults.savePath,
  };
}

/**
 * fake 打开对话框：读取 openPath 文本。文件不存在（ENOENT）= 用户取消，
 * 返回 ok({ content: null })（非错误）；其他读取错误为结构化失败。
 */
export async function fakeOpenTextFile(
  openPath: string,
): Promise<Result<OpenTextFileResponse>> {
  try {
    const content = await readFile(openPath, "utf8");
    return ok({ content });
  } catch (cause) {
    if ((cause as { code?: string }).code === "ENOENT") {
      // 文件不存在 = 用户取消打开对话框：非错误。
      return ok({ content: null });
    }
    return fail(
      createMamepError({
        code: "OPEN_TEXT_FILE_FAILED",
        category: "persistence",
        userMessageKey: "workspace.importFailed",
        technicalMessage:
          cause instanceof Error ? cause.message : String(cause),
      }),
    );
  }
}

/**
 * fake 保存对话框：把 content 写入 savePath（UTF-8），返回 saved:true + 实际路径。
 */
export async function fakeSaveTextFile(
  savePath: string,
  content: string,
): Promise<Result<SaveTextFileResponse>> {
  try {
    await writeFile(savePath, content, "utf8");
    return ok({ saved: true, filePath: savePath });
  } catch (cause) {
    return fail(
      createMamepError({
        code: "SAVE_TEXT_FILE_FAILED",
        category: "persistence",
        userMessageKey: "workspace.exportFailed",
        technicalMessage:
          cause instanceof Error ? cause.message : String(cause),
      }),
    );
  }
}
