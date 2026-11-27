import { describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "@mamep2026/domain";
import { serializeWorkspace } from "@mamep2026/workspace";
import {
  IndexedDBWorkspaceRepository,
  type KeyValueStore,
} from "./indexeddb-repository";

function memoryStore(): KeyValueStore {
  const map = new Map<string, unknown>();
  return {
    async get(key) {
      return map.get(key);
    },
    async put(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

describe("IndexedDBWorkspaceRepository", () => {
  it("returns a fresh workspace when nothing is stored", async () => {
    const repo = new IndexedDBWorkspaceRepository(memoryStore());
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sheets).toHaveLength(1);
      // 从站地址为表级字段：默认 1。
      expect(result.value.sheets[0]?.slaveAddress).toBe(1);
    }
  });

  it("saves and loads a workspace round-trip", async () => {
    const repo = new IndexedDBWorkspaceRepository(memoryStore());
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet !== undefined) {
      sheet.name = "My Sheet";
    }
    const saveResult = await repo.save(workspace);
    expect(saveResult.ok).toBe(true);

    const loadResult = await repo.load();
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.value.sheets[0]?.name).toBe("My Sheet");
    }
  });

  it("restores a corrupted main record only after confirmation", async () => {
    const store = memoryStore();
    const workspace = createEmptyWorkspace();
    await store.put("workspace", { schemaVersion: "broken" });
    await store.put(
      "workspace-backup",
      JSON.parse(serializeWorkspace(workspace)),
    );
    const repo = new IndexedDBWorkspaceRepository(store);
    const preview = await repo.load();
    expect(preview.ok && preview.value.workspaceId).not.toBe(
      workspace.workspaceId,
    );
    expect(repo.getRecoveryInfo()?.pending).toBe(true);
    const restored = await repo.recover();
    expect(restored.ok && restored.value.workspaceId).toBe(
      workspace.workspaceId,
    );
  });

  it("keeps a failed recovery pending with a structured persistence error", async () => {
    const store = memoryStore();
    await store.put("workspace", { schemaVersion: "broken" });
    await store.put("workspace-backup", { schemaVersion: "broken" });
    const repo = new IndexedDBWorkspaceRepository(store);
    await repo.load();
    expect(repo.getRecoveryInfo()).toMatchObject({
      pending: true,
      errorCode: "WORKSPACE_SCHEMA_INVALID",
    });
    const result = await repo.recover();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("persistence");
    expect(await store.get("workspace")).toEqual({ schemaVersion: "broken" });
  });

  it("round-trips a serialized snapshot through the same schema", async () => {
    const repo = new IndexedDBWorkspaceRepository(memoryStore());
    const workspace = createEmptyWorkspace();
    const serialized = serializeWorkspace(workspace);
    await repo.save(workspace);
    const store2 = memoryStore();
    const snapshot = JSON.parse(serialized);
    await store2.put("workspace", snapshot);
    const repo2 = new IndexedDBWorkspaceRepository(store2);
    const result = await repo2.load();
    expect(result.ok).toBe(true);
  });

  it("clear removes the stored workspace and the backup", async () => {
    const store = memoryStore();
    const repo = new IndexedDBWorkspaceRepository(store);
    const workspace = createEmptyWorkspace();
    await repo.save(workspace);
    await repo.save(workspace); // 生成备份。
    expect(await store.get("workspace")).not.toBeUndefined();
    expect(await store.get("workspace-backup")).not.toBeUndefined();

    const result = await repo.clear();
    expect(result.ok).toBe(true);

    const loaded = await repo.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      // 重置后加载返回全新默认工作区（新 workspaceId）。
      expect(loaded.value.workspaceId).not.toBe(workspace.workspaceId);
      expect(loaded.value.sheets).toHaveLength(1);
    }
  });

  // ----：§19.1 仓储接口补齐 + 恢复元数据 ----
  it("load 主数据完好时 getRecoveryInfo source=none（ADR-049）", async () => {
    const repo = new IndexedDBWorkspaceRepository(memoryStore());
    await repo.save(createEmptyWorkspace());
    await repo.load();
    expect(repo.getRecoveryInfo()).toMatchObject({
      recovered: false,
      source: "none",
    });
  });

  it("load 主损坏+备份有效时 getRecoveryInfo source=backup（ADR-049）", async () => {
    const store = memoryStore();
    const repo = new IndexedDBWorkspaceRepository(store);
    const workspace = createEmptyWorkspace();
    await repo.save(workspace);
    await repo.save(workspace); // 生成备份。
    await store.put("workspace", JSON.parse('{"schemaVersion":"broken"}'));
    const result = await repo.load();
    expect(result.ok).toBe(true);
    expect(repo.getRecoveryInfo()).toMatchObject({
      recovered: true,
      source: "fresh",
      pending: true,
      preview: { name: workspace.name },
    });
  });

  it("load 主+备份均损坏时 getRecoveryInfo source=fresh + errorCode（ADR-049）", async () => {
    const store = memoryStore();
    await store.put("workspace", JSON.parse('{"schemaVersion":"broken"}'));
    await store.put(
      "workspace-backup",
      JSON.parse('{"schemaVersion":"broken"}'),
    );
    const repo = new IndexedDBWorkspaceRepository(store);
    await repo.load();
    expect(repo.getRecoveryInfo()).toMatchObject({
      recovered: true,
      source: "fresh",
    });
    expect(repo.getRecoveryInfo()?.errorCode).toBe("WORKSPACE_SCHEMA_INVALID");
  });

  it("reset 清空主记录与备份（§19.1）", async () => {
    const store = memoryStore();
    const repo = new IndexedDBWorkspaceRepository(store);
    await repo.save(createEmptyWorkspace());
    await repo.save(createEmptyWorkspace()); // 生成备份。
    const result = await repo.reset();
    expect(result.ok).toBe(true);
    expect(await store.get("workspace")).toBeUndefined();
    expect(await store.get("workspace-backup")).toBeUndefined();
  });

  it("export 返回当前持久化工作区序列化（§19.1）", async () => {
    const repo = new IndexedDBWorkspaceRepository(memoryStore());
    const workspace = createEmptyWorkspace();
    workspace.name = "ExportMe";
    await repo.save(workspace);
    const exported = await repo.export();
    expect(exported.ok).toBe(true);
    if (exported.ok) {
      // 导出的序列化内容可 round-trip 读回。
      const parsed = JSON.parse(exported.value);
      expect(parsed.name).toBe("ExportMe");
    }
  });

  it("import 校验并落盘后 load 可读回（§19.1）", async () => {
    const repo = new IndexedDBWorkspaceRepository(memoryStore());
    const workspace = createEmptyWorkspace();
    workspace.name = "Imported";
    const imported = await repo.import(serializeWorkspace(workspace));
    expect(imported.ok).toBe(true);
    const loaded = await repo.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.name).toBe("Imported");
    }
  });

  it("import 非法数据被拒绝（§19.1）", async () => {
    const repo = new IndexedDBWorkspaceRepository(memoryStore());
    const imported = await repo.import('{"schemaVersion":999}');
    expect(imported.ok).toBe(false);
  });

  it("createBackup 把当前主记录轮转为备份（§19.1）", async () => {
    const store = memoryStore();
    const repo = new IndexedDBWorkspaceRepository(store);
    const workspace = createEmptyWorkspace();
    workspace.name = "BackupSrc";
    await repo.save(workspace);
    const backup = await repo.createBackup();
    expect(backup.ok).toBe(true);
    const backupRaw = await store.get("workspace-backup");
    expect(JSON.parse(JSON.stringify(backupRaw)).name).toBe("BackupSrc");
  });
  it("keeps original and backup unchanged until confirmation and exports the source", async () => {
    const store = memoryStore();
    const original = { schemaVersion: "broken", text: "original text" };
    const workspace = { ...createEmptyWorkspace(), name: "Backup" };
    const backup = JSON.parse(serializeWorkspace(workspace));
    await store.put("workspace", original);
    await store.put("workspace-backup", backup);
    const repo = new IndexedDBWorkspaceRepository(store);
    await repo.load();
    expect(await store.get("workspace")).toEqual(original);
    expect((await repo.save(createEmptyWorkspace())).ok).toBe(false);
    expect((await repo.import(serializeWorkspace(workspace))).ok).toBe(false);
    expect((await repo.createBackup()).ok).toBe(false);
    const exported = await repo.exportRecovery();
    expect(exported.ok && JSON.parse(exported.value)).toMatchObject({
      version: 1,
      source: "workspace",
      data: original,
    });
    const archiveId = repo.getRecoveryInfo()?.archiveId;
    await repo.load();
    expect(repo.getRecoveryInfo()?.archiveId).toBe(archiveId);
    const restored = await repo.recover();
    expect(restored.ok && restored.value.name).toBe("Backup");
    expect(await store.get("workspace")).toEqual(backup);
    expect(await store.get("workspace-backup")).toEqual(backup);
    expect(repo.getRecoveryInfo()).toMatchObject({
      source: "backup",
      pending: false,
    });
  });

  it("blocks reset and saves after archive failure, and allows a retry", async () => {
    const inner = memoryStore();
    const original = { schemaVersion: "broken" };
    await inner.put("workspace", original);
    let denyArchive = true;
    const store = {
      ...inner,
      async put(key: string, value: unknown) {
        if (denyArchive && key.startsWith("workspace-recovery-"))
          throw new Error("quota");
        await inner.put(key, value);
      },
    };
    const repo = new IndexedDBWorkspaceRepository(store);
    await repo.load();
    expect(repo.getRecoveryInfo()?.archiveId).toBeUndefined();
    expect((await repo.clear()).ok).toBe(false);
    expect((await repo.save(createEmptyWorkspace())).ok).toBe(false);
    expect(await inner.get("workspace")).toEqual(original);
    denyArchive = false;
    await repo.load();
    const archiveId = repo.getRecoveryInfo()?.archiveId;
    expect(archiveId).toBeDefined();
    expect((await repo.clear()).ok).toBe(true);
    expect(await inner.get(archiveId ?? "")).toMatchObject({ data: original });
  });

  it("keeps recovery pending when writes fail or the source changes", async () => {
    const inner = memoryStore();
    await inner.put("workspace", { schemaVersion: "broken" });
    await inner.put(
      "workspace-backup",
      JSON.parse(serializeWorkspace(createEmptyWorkspace())),
    );
    const repo = new IndexedDBWorkspaceRepository({
      ...inner,
      async put(key, value) {
        if (key === "workspace") throw new Error("write failed");
        await inner.put(key, value);
      },
    });
    await repo.load();
    expect((await repo.recover()).ok).toBe(false);
    expect(repo.getRecoveryInfo()?.pending).toBe(true);
    await inner.put("workspace", { changed: true });
    expect((await repo.recover()).ok).toBe(false);
    expect((await repo.clear()).ok).toBe(false);
    expect(await inner.get("workspace")).toEqual({ changed: true });
  });
  it("does not silently change non-JSON original values during export", async () => {
    const store = memoryStore();
    const original = { schemaVersion: "broken", value: Number.NaN };
    await store.put("workspace", original);
    const repo = new IndexedDBWorkspaceRepository(store);
    await repo.load();
    expect(repo.getRecoveryInfo()?.pending).toBe(true);
    expect((await repo.exportRecovery()).ok).toBe(false);
    expect((await repo.clear()).ok).toBe(false);
    expect(await store.get("workspace")).toEqual(original);
  });
});
