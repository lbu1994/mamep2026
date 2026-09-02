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
    apiVersion: "1.0",
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
  it("init 时从 store 加载并 hydrate 已安装插件", async () => {
    const registry = new PluginRegistry();
    const { store } = makeStore({
      schemaVersion: 3,
      seeded: false,
      plugins: [{ manifest: manifest(), enabled: false }],
    });
    const coordinator = new PluginPersistenceCoordinator(registry, store);

    const result = await coordinator.init();
    expect(result.ok).toBe(true);
    expect(registry.getSource("installed-a")).toBe("installed");
    expect(registry.isEnabled("installed-a")).toBe(false);
    // v3：isSeeded 与 store 一致；未 markSeeded 时后续保存写回 false。
    expect(coordinator.isSeeded()).toBe(false);
  });

  it("hydrate 期间抑制持久化；随后的事件触发保存快照", async () => {
    const registry = new PluginRegistry();
    const { store, saves } = makeStore();
    const coordinator = new PluginPersistenceCoordinator(registry, store);
    await coordinator.init();

    // init 的 hydrate 不触发保存（空 store，无插件）。
    expect(store.save).not.toHaveBeenCalled();

    // 注册 installed 插件 → 事件 → 保存。
    registry.register(manifest(), { source: "installed" });
    await vi.waitFor(() => expect(store.save).toHaveBeenCalledTimes(1));
    expect(saves[0]?.plugins.map((p) => p.manifest.id)).toEqual([
      "installed-a",
    ]);
  });

  it("启用状态变化触发保存", async () => {
    const registry = new PluginRegistry();
    const { store, saves } = makeStore();
    const coordinator = new PluginPersistenceCoordinator(registry, store);
    await coordinator.init();

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
    await coordinator.init();

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
    await coordinator.init();

    registry.register(manifest(), { source: "installed" });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  });

  it("init 幂等：重复调用不重复订阅/加载；dispose 后不再保存", async () => {
    const registry = new PluginRegistry();
    const { store } = makeStore();
    const coordinator = new PluginPersistenceCoordinator(registry, store);

    await coordinator.init();
    await coordinator.init();
    expect(store.load).toHaveBeenCalledTimes(1);

    coordinator.dispose();
    registry.register(manifest(), { source: "installed" });
    await Promise.resolve();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("seeded 标记（2026-09-02 插件外部化）：markSeeded 后保存写回 seeded:true", async () => {
    const registry = new PluginRegistry();
    const { store, saves } = makeStore();
    const coordinator = new PluginPersistenceCoordinator(registry, store);
    await coordinator.init();
    expect(coordinator.isSeeded()).toBe(false);

    // 首次安装随包插件：注册 → markSeeded → 保存快照（含 seeded:true）。
    registry.register(
      manifest({ id: "bundled-x", platform: { web: true, node: true } }),
      { source: "installed" },
    );
    coordinator.markSeeded();
    await vi.waitFor(() => expect(store.save).toHaveBeenCalled());
    const last = saves[saves.length - 1];
    expect(last?.seeded).toBe(true);
    expect(last?.plugins.map((p) => p.manifest.id)).toEqual(["bundled-x"]);
  });
});
