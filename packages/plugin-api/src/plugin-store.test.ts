import { describe, expect, it } from "vitest";
import {
  createEmptyPluginStoreData,
  migratePluginStoreData,
  PLUGIN_STORE_SCHEMA_VERSION,
  pluginStoreDataSchema,
} from "./plugin-store";

describe("plugin store v1→v2 迁移（ADR-039）", () => {
  it("v1 老数据：补 apiVersion/requiredCapabilities、permissions 筛合法、contributes 保 panels", () => {
    const result = migratePluginStoreData({
      schemaVersion: 1,
      plugins: [
        {
          manifest: {
            id: "old-a",
            name: "Old A",
            version: "1.0.0",
            description: "old",
            platform: { web: true, node: false },
            permissions: ["ui.panel", "theme"],
            contributions: { panels: [{ id: "p", titleKey: "x" }] },
          },
          enabled: true,
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schemaVersion).toBe(PLUGIN_STORE_SCHEMA_VERSION);
    const manifest = result.value.plugins[0]?.manifest;
    expect(manifest?.apiVersion).toBe("1.0");
    expect(manifest?.requiredCapabilities).toEqual([]);
    expect(manifest?.permissions).toEqual(["theme"]);
    expect(manifest?.contributes).toEqual({
      panels: [{ id: "p", titleKey: "x" }],
    });
  });

  it("schemaVersion 2 严格校验：损坏数据 → PLUGIN_STORE_SCHEMA_INVALID", () => {
    const bad = migratePluginStoreData({ schemaVersion: 2, plugins: "oops" });
    expect(bad.ok).toBe(false);
    const badManifest = migratePluginStoreData({
      schemaVersion: 2,
      plugins: [{ manifest: { id: "x" }, enabled: true }],
    });
    expect(badManifest.ok).toBe(false);
  });

  it("v1 且 plugins 非数组 → 视为损坏（PLUGIN_STORE_SCHEMA_INVALID）", () => {
    const result = migratePluginStoreData({ schemaVersion: 1, plugins: "oops" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PLUGIN_STORE_SCHEMA_INVALID");
  });

  it("非对象 → PLUGIN_STORE_SCHEMA_INVALID", () => {
    expect(migratePluginStoreData(null).ok).toBe(false);
    expect(migratePluginStoreData("nope").ok).toBe(false);
  });

  it("非法条目跳过、合法条目保留（迁移不阻断）", () => {
    const result = migratePluginStoreData({
      plugins: [
        { manifest: { id: "x" }, enabled: true },
        {
          manifest: {
            id: "ok",
            name: "OK",
            version: "1",
            description: "",
            platform: { web: true, node: false },
          },
          enabled: true,
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.plugins).toHaveLength(1);
  });

  it("空 store 兜底 schemaVersion 2", () => {
    expect(createEmptyPluginStoreData().schemaVersion).toBe(
      PLUGIN_STORE_SCHEMA_VERSION,
    );
    expect(pluginStoreDataSchema.safeParse(createEmptyPluginStoreData()).success).toBe(
      true,
    );
  });
});
