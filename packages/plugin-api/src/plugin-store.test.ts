import { describe, expect, it } from "vitest";
import {
  createEmptyPluginStoreData,
  migratePluginStoreData,
  PLUGIN_STORE_SCHEMA_VERSION,
  pluginStoreDataSchema,
} from "./plugin-store";

describe("plugin store v4（ADR-054：删除随包插件机制）", () => {
  it("当前版本（v4）严格校验：损坏数据 → PLUGIN_STORE_SCHEMA_INVALID", () => {
    const bad = migratePluginStoreData({ schemaVersion: 4, plugins: "oops" });
    expect(bad.ok).toBe(false);
    const badManifest = migratePluginStoreData({
      schemaVersion: 4,
      plugins: [{ manifest: { id: "x" }, enabled: true }],
    });
    expect(badManifest.ok).toBe(false);
    // 已删除的 seeded 字段（v3 遗留）不再参与校验：v4 数据带该键也不视为损坏。
    const withSeeded = migratePluginStoreData({
      schemaVersion: 4,
      plugins: [],
      seeded: true,
    });
    expect(withSeeded.ok).toBe(true);
  });

  it("v4 保留 entrySource 与 executionMode（重启重建执行面的依据）", () => {
    const result = migratePluginStoreData({
      schemaVersion: 4,
      plugins: [
        {
          manifest: {
            id: "installed-a",
            name: "A",
            version: "1.0.0",
            apiVersion: "2.0",
            description: "",
            platform: { web: true, node: true },
          },
          enabled: true,
          entrySource: "export const manifest = {};",
          executionMode: "same-process",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plugins[0]?.entrySource).toBe(
      "export const manifest = {};",
    );
    expect(result.value.plugins[0]?.executionMode).toBe("same-process");
  });

  it("v1/v2/v3 → v4：清空已安装插件（一律手动安装，需重新安装）", () => {
    for (const schemaVersion of [1, 2, 3] as const) {
      const result = migratePluginStoreData({
        schemaVersion,
        plugins: [
          {
            manifest: {
              id: "old",
              name: "Old",
              version: "1.0.0",
              apiVersion: "1.0",
              description: "",
              platform: { web: true, node: false },
            },
            enabled: true,
          },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.schemaVersion).toBe(PLUGIN_STORE_SCHEMA_VERSION);
      expect(result.value.plugins).toEqual([]);
    }
  });

  it("v1 且 plugins 非数组 → 视为损坏（PLUGIN_STORE_SCHEMA_INVALID）", () => {
    const result = migratePluginStoreData({
      schemaVersion: 1,
      plugins: "oops",
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("PLUGIN_STORE_SCHEMA_INVALID");
  });

  it("非对象 → PLUGIN_STORE_SCHEMA_INVALID", () => {
    expect(migratePluginStoreData(null).ok).toBe(false);
    expect(migratePluginStoreData("nope").ok).toBe(false);
  });

  it("空 store 兜底 schemaVersion 4", () => {
    const empty = createEmptyPluginStoreData();
    expect(empty.schemaVersion).toBe(PLUGIN_STORE_SCHEMA_VERSION);
    expect(empty.plugins).toEqual([]);
    expect(pluginStoreDataSchema.safeParse(empty).success).toBe(true);
  });
});
