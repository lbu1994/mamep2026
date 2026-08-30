/**
 * IndexedDBPluginStore 单测（ADR-038，2026-08-30）。
 * 注入 fake KeyValueStore，覆盖：首次 load（无 key）空存储、roundtrip、损坏数据错误、
 * 非法数据拒绝写入、存储异常错误映射（category plugin）。
 */
import { describe, expect, it } from "vitest";
import type { KeyValueStore } from "@mamep2026/platform-web";
import { IndexedDBPluginStore } from "./indexeddb-plugin-store";
import type { PluginStoreData } from "@mamep2026/plugin-api";

const manifest = {
  id: "installed-a",
  name: "Installed A",
  version: "1.0.0",
  description: "A user-installed plugin",
  platform: { web: true, node: false },
  permissions: [],
  contributions: { panels: [] },
};

function storeData(): PluginStoreData {
  return { schemaVersion: 1, plugins: [{ manifest, enabled: true }] };
}

function makeKv(initial?: unknown): {
  kv: KeyValueStore;
  stored: { value: unknown };
} {
  const stored: { value: unknown } = { value: initial };
  return {
    kv: {
      get: async (key: string) => (key === "plugins" ? stored.value : undefined),
      put: async (key: string, value: unknown) => {
        if (key === "plugins") stored.value = value;
      },
      delete: async () => {
        stored.value = undefined;
      },
    },
    stored,
  };
}

describe("IndexedDBPluginStore", () => {
  it("首次 load（无 key）返回空插件存储", async () => {
    const { kv } = makeKv(undefined);
    const store = new IndexedDBPluginStore(kv);
    const result = await store.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ schemaVersion: 1, plugins: [] });
    }
  });

  it("save 后 load 往返一致（roundtrip）", async () => {
    const { kv } = makeKv(undefined);
    const store = new IndexedDBPluginStore(kv);
    const data = storeData();
    expect((await store.save(data)).ok).toBe(true);
    const loaded = await store.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value).toEqual(data);
  });

  it("损坏数据返回结构化错误（category plugin）", async () => {
    const { kv } = makeKv({ schemaVersion: 1, plugins: "oops" });
    const store = new IndexedDBPluginStore(kv);
    const result = await store.load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PLUGIN_STORE_SCHEMA_INVALID");
      expect(result.error.category).toBe("plugin");
    }
  });

  it("非法数据拒绝写入", async () => {
    const { kv, stored } = makeKv(undefined);
    const store = new IndexedDBPluginStore(kv);
    const result = await store.save({
      schemaVersion: 1,
      plugins: [{ manifest: { id: "x" }, enabled: true }],
    } as unknown as PluginStoreData);
    expect(result.ok).toBe(false);
    expect(stored.value).toBeUndefined();
  });

  it("存储异常映射为 PLUGIN_STORE_LOAD_FAILED（category plugin）", async () => {
    const kv: KeyValueStore = {
      get: async () => {
        throw new Error("idb blocked");
      },
      put: async () => undefined,
      delete: async () => undefined,
    };
    const store = new IndexedDBPluginStore(kv);
    const result = await store.load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PLUGIN_STORE_LOAD_FAILED");
      expect(result.error.category).toBe("plugin");
    }
  });
});
