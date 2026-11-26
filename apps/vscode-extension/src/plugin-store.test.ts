/**
 * GlobalStatePluginStore 单测。
 * 注入 fake Memento，覆盖：首次 load（无数据）空存储、roundtrip、损坏数据错误、非法数据
 * 拒绝写入、写入失败错误映射（category plugin）。
 */
import { describe, expect, it } from "vitest";
import { GlobalStatePluginStore, type KeyValueMemento } from "./plugin-store";
import type { PluginManifest, PluginStoreData } from "@mamep2026/plugin-api";
import {
  createPluginApproval,
  matchesPluginApproval,
} from "@mamep2026/plugin-api";
import { createHash } from "node:crypto";

const manifest: PluginManifest = {
  id: "installed-a",
  name: "Installed A",
  version: "1.0.0",
  apiVersion: "2.0",
  description: "A user-installed plugin",
  requiredCapabilities: [],
  platform: { web: true, node: false },
  permissions: [],
  contributes: { panels: [] },
};

function storeData(): PluginStoreData {
  return { schemaVersion: 5, plugins: [{ manifest, enabled: true }] };
}

function makeMemento(initial?: unknown): {
  memento: KeyValueMemento;
  stored: { value: unknown };
} {
  const stored: { value: unknown } = { value: initial };
  return {
    memento: {
      get: <T>(key: string): T | undefined =>
        key === "mamep2026.plugins" ? (stored.value as T) : undefined,
      update: async (key: string, value: unknown) => {
        if (key === "mamep2026.plugins") stored.value = value;
      },
    },
    stored,
  };
}

describe("GlobalStatePluginStore", () => {
  it("retains source-bound consent in Host globalState across store recreation", async () => {
    const hash = async (content: string) =>
      createHash("sha256").update(content).digest("hex");
    const data = storeData();
    const plugin = data.plugins[0];
    if (plugin === undefined) throw new Error("Plugin fixture missing");
    plugin.entrySource = "export function activate() {}";
    plugin.executionMode = "same-process";
    plugin.approval = await createPluginApproval(plugin, hash);
    const values = new Map<string, unknown>();
    const memento: KeyValueMemento = {
      get: <T>(key: string) => values.get(key) as T | undefined,
      update: async (key, value) => {
        values.set(key, structuredClone(value));
      },
    };
    expect((await new GlobalStatePluginStore(memento).save(data)).ok).toBe(
      true,
    );
    expect([...values.keys()]).toEqual(["mamep2026.plugins"]);
    const loaded = await new GlobalStatePluginStore(memento).load();
    expect(loaded).toEqual({ ok: true, value: data });
    if (!loaded.ok || loaded.value.plugins[0] === undefined)
      throw new Error("Saved plugin missing");
    const restored = loaded.value.plugins[0];
    expect(await matchesPluginApproval(restored, hash)).toBe(true);
    expect(
      await matchesPluginApproval(
        { ...restored, executionMode: "isolated" },
        hash,
      ),
    ).toBe(false);
    expect(
      await matchesPluginApproval(
        { ...restored, entrySource: "changed" },
        hash,
      ),
    ).toBe(false);
    expect(values.get("mamep2026.plugins")).toEqual(data);
  });

  it("首次 load（无数据）返回空插件存储", async () => {
    const { memento } = makeMemento(undefined);
    const store = new GlobalStatePluginStore(memento);
    const result = await store.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        schemaVersion: 5,
        plugins: [],
      });
    }
  });

  it("save 后 load 往返一致（roundtrip）", async () => {
    const { memento } = makeMemento(undefined);
    const store = new GlobalStatePluginStore(memento);
    const data = storeData();
    expect((await store.save(data)).ok).toBe(true);
    const loaded = await store.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value).toEqual(data);
  });

  it("损坏数据返回结构化错误（category plugin）", async () => {
    const { memento } = makeMemento({ schemaVersion: 1, plugins: "oops" });
    const store = new GlobalStatePluginStore(memento);
    const result = await store.load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PLUGIN_STORE_SCHEMA_INVALID");
      expect(result.error.category).toBe("plugin");
    }
  });

  it("非法数据拒绝写入", async () => {
    const { memento, stored } = makeMemento(undefined);
    const store = new GlobalStatePluginStore(memento);
    const result = await store.save({
      schemaVersion: 1,
      plugins: [{ manifest: { id: "x" }, enabled: true }],
    } as unknown as PluginStoreData);
    expect(result.ok).toBe(false);
    expect(stored.value).toBeUndefined();
  });

  it("写入失败映射为 PLUGIN_STORE_WRITE_FAILED（category plugin）", async () => {
    const memento: KeyValueMemento = {
      get: () => undefined,
      update: async () => {
        throw new Error("write blocked");
      },
    };
    const store = new GlobalStatePluginStore(memento);
    const result = await store.save(storeData());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PLUGIN_STORE_WRITE_FAILED");
      expect(result.error.category).toBe("plugin");
    }
  });
});
