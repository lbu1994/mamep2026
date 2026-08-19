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

  it("recovers from a corrupted main record using the backup", async () => {
    const store = memoryStore();
    const repo = new IndexedDBWorkspaceRepository(store);
    const workspace = createEmptyWorkspace();
    await repo.save(workspace);
    // 第二次保存时才会把上次主记录轮转为备份。
    await repo.save(workspace);

    // 破坏主记录。
    await store.put("workspace", JSON.parse('{"schemaVersion":"broken"}'));
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.workspaceId).toBe(workspace.workspaceId);
    }
  });

  it("returns a structured persistence error when both records are corrupted", async () => {
    const store = memoryStore();
    await store.put("workspace", JSON.parse('{"schemaVersion":"broken"}'));
    await store.put(
      "workspace-backup",
      JSON.parse('{"schemaVersion":"broken"}'),
    );
    const repo = new IndexedDBWorkspaceRepository(store);
    const result = await repo.load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("persistence");
      expect(result.error.code).toBe("WORKSPACE_SCHEMA_INVALID");
    }
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
});
