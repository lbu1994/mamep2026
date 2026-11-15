/**
 * BridgePluginStore 单测。
 * 覆盖：load 经桥透传（含空存储）、save 经桥透传、桥错误原样往返（category/userMessageKey）。
 */
import { describe, expect, it, vi } from "vitest";
import { BridgePluginStore } from "./bridge-plugin-store";
import type {
  MamepHostApi,
  PluginStoreDataResponse,
} from "@mamep2026/platform-api";
import type { Result } from "@mamep2026/domain";

const manifest = {
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

const emptyStore: PluginStoreDataResponse = {
  schemaVersion: 4,
  plugins: [],
};

function makeBridge(
  load: () => Promise<Result<PluginStoreDataResponse>> = vi.fn(
    async (): Promise<Result<PluginStoreDataResponse>> => ({
      ok: true,
      value: emptyStore,
    }),
  ),
) {
  const bridge: Pick<MamepHostApi, "pluginStoreLoad" | "pluginStoreSave"> = {
    pluginStoreLoad: load,
    pluginStoreSave: vi.fn(async (): Promise<Result<null>> => ({
      ok: true,
      value: null,
    })),
  };
  return bridge;
}

describe("BridgePluginStore", () => {
  it("load 经桥透传插件存储数据（含空存储）", async () => {
    const bridge = makeBridge();
    const store = new BridgePluginStore(bridge);
    const result = await store.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(emptyStore);
    }
  });

  it("save 经桥透传数据并映射 ok", async () => {
    const bridge = makeBridge();
    const store = new BridgePluginStore(bridge);
    const data = {
      schemaVersion: 4 as const,
      plugins: [{ manifest, enabled: true }],
    };
    const result = await store.save(data);
    expect(result.ok).toBe(true);
    expect(bridge.pluginStoreSave).toHaveBeenCalledWith(data);
  });

  it("桥错误原样往返（category/userMessageKey 不丢失）", async () => {
    const bridge = makeBridge(
      vi.fn(async (): Promise<Result<PluginStoreDataResponse>> => ({
        ok: false,
        error: {
          code: "PLUGIN_STORE_LOAD_FAILED",
          category: "plugin",
          severity: "error",
          retryable: false,
          userMessageKey: "errors.pluginStoreError",
          technicalMessage: "boom",
        },
      })),
    );
    const store = new BridgePluginStore(bridge);
    const result = await store.load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PLUGIN_STORE_LOAD_FAILED");
      expect(result.error.category).toBe("plugin");
      expect(result.error.userMessageKey).toBe("errors.pluginStoreError");
    }
  });
});
