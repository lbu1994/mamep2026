/**
 * WorkspaceFileRepository 单测（docs/TECH_DESIGN.md §19.4）。
 * 注入临时目录（os.tmpdir + mkdtemp），覆盖：roundtrip、原子替换与 .bak 轮转、损坏恢复
 * （归档及确认）、双坏保护、无文件空工作区、clear、v1→v4 迁移、错误映射（category persistence）。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  createEmptyWorkspace,
  workspaceSchemaVersion,
} from "@mamep2026/domain";
import { serializeWorkspace } from "@mamep2026/workspace";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
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

  it("archives exact bytes and waits for confirmation before applying the backup", async () => {
    const { repo, dir } = await makeRepo();
    const workspace = { ...createEmptyWorkspace(), name: "Recovered" };
    await repo.save(workspace);
    await repo.save(createEmptyWorkspace());
    const original = Buffer.from([0xff, 0xfe, 0x7b, 0x00]);
    await writeFile(path.join(dir, MAIN_FILE), original);
    const loaded = await repo.load();
    expect(loaded.ok && loaded.value.name).not.toBe("Recovered");
    expect(repo.getRecoveryInfo()).toMatchObject({
      pending: true,
      preview: { name: "Recovered", sheets: 1 },
    });
    expect(await readFile(path.join(dir, MAIN_FILE))).toEqual(original);
    expect((await repo.save(createEmptyWorkspace())).ok).toBe(false);
    expect(
      (await repo.import(serializeWorkspace(createEmptyWorkspace()))).ok,
    ).toBe(false);
    expect((await repo.createBackup()).ok).toBe(false);
    const exported = await repo.exportRecovery();
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const archive = JSON.parse(exported.value);
    expect(archive.source).toBe(path.join(dir, MAIN_FILE));
    expect(Buffer.from(archive.data, "base64")).toEqual(original);
    const recovered = await repo.recover();
    expect(recovered.ok && recovered.value).toEqual(workspace);
    expect(await readFile(path.join(dir, MAIN_FILE), "utf8")).toBe(
      serializeWorkspace(workspace),
    );
    expect(await readFile(path.join(dir, BACKUP_FILE), "utf8")).toBe(
      serializeWorkspace(workspace),
    );
    expect(repo.getRecoveryInfo()).toMatchObject({
      pending: false,
      source: "backup",
    });
    expect((await repo.save(createEmptyWorkspace())).ok).toBe(true);
  });

  it("retains both damaged files and allows explicit reset only after archiving", async () => {
    const { repo, dir } = await makeRepo();
    await writeFile(path.join(dir, MAIN_FILE), "{ broken");
    await writeFile(path.join(dir, BACKUP_FILE), "also broken");
    expect((await repo.load()).ok).toBe(true);
    expect(repo.getRecoveryInfo()?.preview).toBeUndefined();
    expect((await repo.recover()).ok).toBe(false);
    expect((await repo.exportRecovery()).ok).toBe(true);
    expect((await repo.clear()).ok).toBe(true);
    expect(await readdir(path.join(dir, "workspace-recovery"))).toHaveLength(1);
    expect(repo.getRecoveryInfo()).toBeNull();
  });

  it("blocks every mutation when archiving fails", async () => {
    const { repo, dir } = await makeRepo();
    const backup = serializeWorkspace(createEmptyWorkspace());
    await writeFile(path.join(dir, MAIN_FILE), "broken");
    await writeFile(path.join(dir, BACKUP_FILE), backup);
    await writeFile(path.join(dir, "workspace-recovery"), "not a directory");
    await repo.load();
    expect(repo.getRecoveryInfo()).toMatchObject({
      pending: true,
      errorCode: "PERSISTENCE_RECOVERY_PREPARE_FAILED",
    });
    for (const result of [
      await repo.save(createEmptyWorkspace()),
      await repo.clear(),
      await repo.createBackup(),
      await repo.import(backup),
      await repo.recover(),
    ])
      expect(result.ok).toBe(false);
    expect(await readFile(path.join(dir, MAIN_FILE), "utf8")).toBe("broken");
    expect(await readFile(path.join(dir, BACKUP_FILE), "utf8")).toBe(backup);
  });

  it("rejects a changed source or backup and reuses the archive after restart", async () => {
    const { repo, dir } = await makeRepo();
    const workspace = createEmptyWorkspace();
    await writeFile(path.join(dir, MAIN_FILE), "broken");
    await writeFile(path.join(dir, BACKUP_FILE), serializeWorkspace(workspace));
    await repo.load();
    const reopened = new WorkspaceFileRepository(dir);
    await reopened.load();
    expect(await readdir(path.join(dir, "workspace-recovery"))).toHaveLength(1);
    await writeFile(path.join(dir, MAIN_FILE), "changed");
    expect((await repo.recover()).ok).toBe(false);
    expect((await repo.clear()).ok).toBe(false);
    await writeFile(path.join(dir, MAIN_FILE), "broken");
    await writeFile(path.join(dir, BACKUP_FILE), "changed backup");
    expect((await reopened.recover()).ok).toBe(false);
    expect(await readFile(path.join(dir, MAIN_FILE), "utf8")).toBe("broken");
  });

  it("offers a surviving backup when the main file is missing", async () => {
    const { repo, dir } = await makeRepo();
    const backup = createEmptyWorkspace();
    await writeFile(path.join(dir, BACKUP_FILE), serializeWorkspace(backup));
    await repo.load();
    expect(repo.getRecoveryInfo()).toMatchObject({
      pending: true,
      preview: { name: backup.name },
    });
    expect((await repo.recover()).ok).toBe(true);
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
      expect(loaded.value.sheets[0]?.name).toBe("HOLDING REGISTERS Sheet 1");
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
  it("keeps the original and backup when recovery cannot write a temporary file", async () => {
    const { repo, dir } = await makeRepo();
    const backup = serializeWorkspace(createEmptyWorkspace());
    await writeFile(path.join(dir, MAIN_FILE), "broken");
    await writeFile(path.join(dir, BACKUP_FILE), backup);
    await repo.load();
    await mkdir(path.join(dir, "workspace.json.tmp"));
    expect((await repo.recover()).ok).toBe(false);
    expect(repo.getRecoveryInfo()?.pending).toBe(true);
    expect(await readFile(path.join(dir, MAIN_FILE), "utf8")).toBe("broken");
    expect(await readFile(path.join(dir, BACKUP_FILE), "utf8")).toBe(backup);
  });
  it("keeps separate archives for a missing main file and literal missing text", async () => {
    const { repo, dir } = await makeRepo();
    await writeFile(
      path.join(dir, BACKUP_FILE),
      serializeWorkspace(createEmptyWorkspace()),
    );
    await repo.load();
    const missingArchive = repo.getRecoveryInfo()?.archiveId;
    await writeFile(path.join(dir, MAIN_FILE), "missing");
    await repo.load();
    expect(repo.getRecoveryInfo()?.archiveId).toBeDefined();
    expect(repo.getRecoveryInfo()?.archiveId).not.toBe(missingArchive);
    expect((await repo.recover()).ok).toBe(true);
  });
});
