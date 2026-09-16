/**
 * dev-fake-dialog 单测（2026-08-29，ADR-033 方案 A）。
 * 覆盖：路径解析（环境变量覆盖 > 缺省约定路径）、fake 打开（文件存在读回 / ENOENT=取消
 * content:null 非错误 / 其他错误结构化失败）、fake 保存（写入 + saved:true + 路径）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  fakeDialogPaths,
  fakeOpenTextFile,
  fakeSaveTextFile,
  MAMEP_FAKE_DIALOG_OPEN_PATH_ENV,
  MAMEP_FAKE_DIALOG_SAVE_PATH_ENV,
} from "./dev-fake-dialog";

let tempDirs: string[] = [];

async function makeTempFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mamep-vscode-fakedialog-"));
  tempDirs.push(dir);
  return path.join(dir, "dialog.json");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs = [];
  // 清理环境变量，避免跨用例泄漏。
  delete process.env[MAMEP_FAKE_DIALOG_OPEN_PATH_ENV];
  delete process.env[MAMEP_FAKE_DIALOG_SAVE_PATH_ENV];
});

describe("fakeDialogPaths", () => {
  it("环境变量覆盖缺省约定路径", () => {
    const overridden = fakeDialogPaths();
    // 未设置时返回 tmpdir 下约定路径（非空、含文件名）。
    expect(overridden.openPath.length).toBeGreaterThan(0);
    expect(overridden.openPath.endsWith(".json")).toBe(true);
    expect(overridden.savePath.length).toBeGreaterThan(0);

    process.env[MAMEP_FAKE_DIALOG_OPEN_PATH_ENV] = "C:\\open.json";
    process.env[MAMEP_FAKE_DIALOG_SAVE_PATH_ENV] = "C:\\save.json";
    const custom = fakeDialogPaths();
    expect(custom.openPath).toBe("C:\\open.json");
    expect(custom.savePath).toBe("C:\\save.json");
  });
});

describe("fakeOpenTextFile", () => {
  it("文件存在时读回 UTF-8 内容", async () => {
    const openPath = await makeTempFile();
    const content = '{"schemaVersion":4,"name":"Open"}';
    await writeFile(openPath, content, "utf8");
    const result = await fakeOpenTextFile(openPath);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.content).toBe(content);
  });

  it("文件不存在（ENOENT）= 用户取消，返回 content:null 非错误", async () => {
    const openPath = path.join(
      await mkdtemp(path.join(tmpdir(), "mamep-vscode-fakedialog-cancel-")),
      "missing.json",
    );
    tempDirs.push(path.dirname(openPath));
    const result = await fakeOpenTextFile(openPath);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.content).toBeNull();
  });
});

describe("fakeSaveTextFile", () => {
  it("写入指定路径并返回 saved:true + 实际路径", async () => {
    const savePath = await makeTempFile();
    const content = '{"schemaVersion":4,"name":"Save"}';
    const result = await fakeSaveTextFile(savePath, content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.saved).toBe(true);
      expect(result.value.filePath).toBe(savePath);
    }
    expect(
      await (await import("node:fs/promises")).readFile(savePath, "utf8"),
    ).toBe(content);
  });
});
