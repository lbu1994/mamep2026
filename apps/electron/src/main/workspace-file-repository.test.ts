/**
 * WorkspaceFileRepository 单测（docs/TECH_DESIGN.md §19.4、ADR-036，2026-08-30）。
 * 注入临时目录（os.tmpdir + mkdtemp），覆盖：roundtrip、原子替换与 .bak 轮转、损坏恢复
 * （自愈写回）、双坏错误、无文件空工作区、clear、v1→v4 迁移、错误映射（category persistence）。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  createEmptyWorkspace,
  workspaceSchemaVersion,
} from "@mamep2026/domain";
import { serializeWorkspace } from "@mamep2026/workspace";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkspaceFileRepository } from "./workspace-file-repository";

const MAIN_FILE = "workspace.json";
const BACKUP_FILE = "workspace.json.bak";

let dirs: string[] = [];

async function makeRepo(): Promise<{
  repo: WorkspaceFileRepository;
  dir: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "mamep-workspace-repo-"));
  dirs.push(dir);
  return { repo: new WorkspaceFileRepository(dir), dir };
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

afterEach(async () => {
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  dirs = [];
});

describe("WorkspaceFileRepository", () => {
  it("首次 load（无文件）返回空工作区", async () => {
    const { repo } = await makeRepo();
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      // createEmptyWorkspace 含 Date.now()/随机 id（非确定性），做结构化断言。
      expect(result.value.schemaVersion).toBe(workspaceSchemaVersion);
      expect(result.value.name).toBe("Workspace");
      expect(result.value.sheets).toHaveLength(1);
    }
  });

  it("save 后 load 往返一致（roundtrip）", async () => {
    const { repo, dir } = await makeRepo();
    const workspace = { ...createEmptyWorkspace(), name: "Roundtrip" };
    const saved = await repo.save(workspace);
    expect(saved.ok).toBe(true);
    const loaded = await repo.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toEqual(workspace);
    }
    // 主文件确实落盘。
    const content = await readIfExists(path.join(dir, MAIN_FILE));
    expect(content).toBe(serializeWorkspace(workspace));
  });

  it("第二次 save 轮转生成 .bak（内容=上一次主文件）", async () => {
    const { repo, dir } = await makeRepo();
    const w1 = { ...createEmptyWorkspace(), name: "First" };
    const w2 = { ...createEmptyWorkspace(), name: "Second" };
    await repo.save(w1);
    await repo.save(w2);
    const mainContent = await readIfExists(path.join(dir, MAIN_FILE));
    const backupContent = await readIfExists(path.join(dir, BACKUP_FILE));
    expect(mainContent).toBe(serializeWorkspace(w2));
    expect(backupContent).toBe(serializeWorkspace(w1));
  });

  it("损坏主文件 + 合法备份 → 从备份恢复并自愈写回主文件", async () => {
    const { repo, dir } = await makeRepo();
    const workspace = { ...createEmptyWorkspace(), name: "Recovered" };
    // 保存两次：第二次保存把第一次的主文件轮转为 .bak（备份内容 = workspace）。
    await repo.save(workspace);
    await repo.save({ ...createEmptyWorkspace(), name: "Second" });
    // 破坏主文件，备份保留上一次内容。
    await writeFile(path.join(dir, MAIN_FILE), "{ broken json", "utf8");
    const loaded = await repo.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toEqual(workspace);
    }
    // 自愈：主文件被写回为合法内容。
    const mainContent = await readIfExists(path.join(dir, MAIN_FILE));
    expect(mainContent).toBe(serializeWorkspace(workspace));
  });

  it("主文件与备份皆损坏 → 返回结构化错误（category persistence）", async () => {
    const { repo, dir } = await makeRepo();
    await writeFile(path.join(dir, MAIN_FILE), "{ broken", "utf8");
    await writeFile(path.join(dir, BACKUP_FILE), "also broken", "utf8");
    const loaded = await repo.load();
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      // 与浏览器 IndexedDBWorkspaceRepository 一致：返回主文件解析错误（非 LOAD_FAILED）。
      expect(loaded.error.code).toBe("WORKSPACE_SCHEMA_INVALID");
      expect(loaded.error.category).toBe("persistence");
      expect(loaded.error.userMessageKey).toBe("errors.workspaceSchemaInvalid");
    }
  });

  it("v1 数据经 parseWorkspace 迁移到当前 schemaVersion（v1→v8）", async () => {
    const { repo, dir } = await makeRepo();
    // 由 v4 空工作区降级构造 v1（含全局 readVerifySettings、无 per-sheet writeVerify）。
    const v4 = JSON.parse(serializeWorkspace(createEmptyWorkspace())) as Record<
      string,
      unknown
    >;
    const v1 = {
      ...v4,
      schemaVersion: 1,
      readVerifySettings: { mode: "off", delayMs: null },
    };
    await writeFile(path.join(dir, MAIN_FILE), JSON.stringify(v1), "utf8");
    const loaded = await repo.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.schemaVersion).toBe(workspaceSchemaVersion);
      expect(loaded.value.sheets[0]?.name).toBe("Sheet 1");
      // 全局 readVerifySettings 已迁移删除（v1→v2）。
      expect(
        (loaded.value as unknown as { readVerifySettings?: unknown })
          .readVerifySettings,
      ).toBeUndefined();
    }
  });

  it("clear 删除主文件与备份", async () => {
    const { repo, dir } = await makeRepo();
    await repo.save(createEmptyWorkspace());
    await repo.save(createEmptyWorkspace());
    expect(await readdir(dir)).not.toHaveLength(0);
    const cleared = await repo.clear();
    expect(cleared.ok).toBe(true);
    expect(await readdir(dir)).toHaveLength(0);
  });

  it("clear 无文件时也成功（幂等）", async () => {
    const { repo } = await makeRepo();
    const cleared = await repo.clear();
    expect(cleared.ok).toBe(true);
  });
});
