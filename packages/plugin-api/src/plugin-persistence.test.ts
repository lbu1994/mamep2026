import { describe, expect, it, vi } from "vitest";
import { fail, ok } from "@mamep2026/domain";
import { createEmptyPluginStoreData } from "./plugin-store";
import { PluginPersistenceCoordinator } from "./plugin-persistence";
import { PluginRegistry } from "./registry";
import type { PluginManifest } from "./manifest";
import type { PluginStoreData, PluginStorePort } from "./plugin-store";

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "installed-a",
    name: "Installed A",
    version: "1.0.0",
    apiVersion: "2.0",
    description: "A user-installed plugin",
    requiredCapabilities: [],
    platform: { web: true, node: false },
    permissions: [],
    contributes: {},
    ...overrides,
  };
}

function makeStore(initial: PluginStoreData | null = null) {
  const saves: PluginStoreData[] = [];
  const store: PluginStorePort = {
    load: vi.fn(async () => {
      if (initial === null) return ok(createEmptyPluginStoreData());
      return ok(initial);
    }),
    save: vi.fn(async (data: PluginStoreData) => {
      saves.push(data);
      return ok(undefined);
    }),
  };
  return { store, saves };
}

describe("PluginPersistenceCoordinator（2026-08-30，ADR-038）", () => {
  it("start 不自行加载/hydrate（ADR-054：加载与注册由装配方承担）", () => {
    const registry = new PluginRegistry();
    const { store } = makeStore({
      schemaVersion: 4,
      plugins: [{ manifest: manifest(), enabled: false }],
    });
    const coordinator = new PluginPersistenceCoordinator(registry, store);
    coordinator.start();
    expect(store.load).not.toHaveBeenCalled();
    expect(registry.getSource("installed-a")).toBeNull();
  });

  it("start 后注册事件触发保存快照", async () => {
    const registry = new PluginRegistry();
    const { store, saves } = makeStore();
    const coordinator = new PluginPersistenceCoordinator(registry, store);
    coordinator.start();
    expect(store.save).not.toHaveBeenCalled();

    // 装配方注册 installed 插件（带执行面）→ 事件 → 保存。
    registry.register(manifest(), {
      source: "installed",
      runtime: { activate() {} },
      entrySource: "export const manifest = {};",
      executionMode: "same-process",
    });
    await vi.waitFor(() => expect(store.save).toHaveBeenCalledTimes(1));
    expect(saves[0]?.plugins.map((p) => p.manifest.id)).toEqual([
      "installed-a",
    ]);
    expect(saves[0]?.plugins[0]?.entrySource).toBe(
      "export const manifest = {};",
    );
  });

  it("启用状态变化触发保存", async () => {
    const registry = new PluginRegistry();
    const { store, saves } = makeStore();
    const coordinator = new PluginPersistenceCoordinator(registry, store);
    coordinator.start();

    registry.register(manifest(), { source: "installed" });
    registry.setEnabled("installed-a", false);
    await vi.waitFor(() => expect(store.save).toHaveBeenCalled());
    expect(
      saves[saves.length - 1]?.plugins.find((p) => p.manifest.id === "installed-a")
        ?.enabled,
    ).toBe(false);
  });

  it("内置插件（builtin）不进入持久化快照", async () => {
    const registry = new PluginRegistry();
    const { store } = makeStore();
    const coordinator = new PluginPersistenceCoordinator(registry, store);
    coordinator.start();

    registry.register(manifest({ id: "builtin-x" })); // 默认 builtin
    await vi.waitFor(() => expect(store.save).toHaveBeenCalledTimes(1));
    const lastSave = (store.save as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as PluginStoreData;
    expect(lastSave.plugins).toHaveLength(0);
  });

  it("保存失败经 onError 回调上报且不抛异常", async () => {
    const registry = new PluginRegistry();
    const onError = vi.fn();
    const store: PluginStorePort = {
      load: vi.fn(async () => ok(createEmptyPluginStoreData())),
      save: vi.fn(async () =>
        fail(
          Object.assign(new Error("write failed"), { code: "PERSISTENCE" }) as never,
        ),
      ),
    };
    const coordinator = new PluginPersistenceCoordinator(registry, store, {
      onError,
    });
    coordinator.start();

    registry.register(manifest(), { source: "installed" });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  });

  it("start 幂等：重复调用不重复订阅；dispose 后不再保存", async () => {
    const registry = new PluginRegistry();
    const { store } = makeStore();
    const coordinator = new PluginPersistenceCoordinator(registry, store);

    coordinator.start();
    coordinator.start();

    coordinator.dispose();
    registry.register(manifest(), { source: "installed" });
    await Promise.resolve();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("执行模式随快照落盘（ADR-054）：同进程 / 隔离插件均记录 executionMode", async () => {
    const registry = new PluginRegistry();
    const { store, saves } = makeStore();
    const coordinator = new PluginPersistenceCoordinator(registry, store);
    coordinator.start();

    registry.register(
      manifest({ id: "same-process-x", platform: { web: true, node: true } }),
      { source: "installed", runtime: { activate() {} } },
    );
    await coordinator.flush();
    const last = saves[saves.length - 1];
    expect(last?.schemaVersion).toBe(4);
    expect(last?.plugins[0]?.executionMode).toBe("same-process");
  });
});
