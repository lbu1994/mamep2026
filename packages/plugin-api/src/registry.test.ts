import { describe, expect, it, vi } from "vitest";
import { ok } from "@mamep2026/domain";
import { PluginRegistry } from "./registry";
import {
  ContributionPointRegistry,
  type ContributionPoint,
} from "./contributions";
import { PANELS_CONTRIBUTION_SCHEMA } from "./builtin-contribution-points";
import type { PluginManifest } from "./manifest";
import type { PluginRemoteRuntime } from "./lifecycle";

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "example-panel",
    name: "Example Panel",
    version: "1.0.0",
    apiVersion: "2.0",
    description: "A built-in example plugin",
    requiredCapabilities: [],
    platform: { web: true, node: false },
    permissions: ["ui-contribution"],
    contributes: {
      panels: [{ id: "example-info", titleKey: "plugins.example.title" }],
    },
    ...overrides,
  };
}

/** 注入 panels 贡献点的注册表（卸载回收贡献测试用）。 */
function registryWithPanels(): PluginRegistry {
  const contributionRegistry = new ContributionPointRegistry();
  contributionRegistry.registerPoint({
    id: "panels",
    schema: PANELS_CONTRIBUTION_SCHEMA,
  } as ContributionPoint<unknown>);
  return new PluginRegistry({ contributionRegistry });
}

/** 假隔离线程运行时（单测）。 */
function fakeRemoteRuntime(overrides: Partial<PluginRemoteRuntime> = {}) {
  return {
    load: vi.fn(async () => ({ ok: true, value: manifest() })),
    activate: vi.fn(async () => {}),
    deactivate: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    ...overrides,
  } as unknown as PluginRemoteRuntime & {
    load: ReturnType<typeof vi.fn>;
    activate: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
}

describe("PluginRegistry", () => {
  it("registers a valid manifest and lists it", () => {
    const registry = new PluginRegistry();
    const result = registry.register(manifest());
    expect(result.ok).toBe(true);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.id).toBe("example-panel");
  });

  it("rejects invalid manifests and isolates the error", () => {
    const registry = new PluginRegistry();
    const invalid = { id: "x" };
    const result = registry.register(invalid as never);
    expect(result.ok).toBe(false);
    // 错误隔离：注册失败不影响已注册插件，也不抛出异常。
    expect(registry.list()).toHaveLength(0);
    expect(registry.getLoadErrors()).toHaveLength(1);
  });

  it("rejects node-only plugins on the web platform", () => {
    const registry = new PluginRegistry();
    const result = registry.register(
      manifest({ platform: { web: false, node: true } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("PLUGIN_PLATFORM_UNSUPPORTED");
  });

  it("enables and disables plugins", () => {
    const registry = new PluginRegistry();
    registry.register(manifest());
    expect(registry.isEnabled("example-panel")).toBe(true);
    registry.setEnabled("example-panel", false);
    expect(registry.isEnabled("example-panel")).toBe(false);
  });

  it("notifies subscribers on registration and state changes", () => {
    const registry = new PluginRegistry();
    const events: string[] = [];
    registry.subscribe((event) => events.push(event.type));
    registry.register(manifest());
    registry.setEnabled("example-panel", false);
    expect(events).toContain("registered");
    expect(events).toContain("enabled-changed");
  });

  it("accepts duplicate ids only once", () => {
    const registry = new PluginRegistry();
    expect(registry.register(manifest()).ok).toBe(true);
    const second = registry.register(manifest({ name: "Renamed" }));
    expect(second.ok).toBe(false);
    expect(registry.list()).toHaveLength(1);
  });
});

describe("PluginRegistry 来源标记与持久化（2026-08-30，ADR-038）", () => {
  it("register 默认 source 为 builtin；可指定 installed", () => {
    const registry = new PluginRegistry();
    registry.register(manifest());
    registry.register(manifest({ id: "installed-panel" }), {
      source: "installed",
    });
    expect(registry.getSource("example-panel")).toBe("builtin");
    expect(registry.getSource("installed-panel")).toBe("installed");
    expect(registry.getSource("unknown")).toBeNull();
  });

  it("snapshot 只包含 installed 来源插件与启用状态", () => {
    const registry = new PluginRegistry();
    registry.register(manifest());
    registry.register(manifest({ id: "installed-a" }), { source: "installed" });
    registry.register(manifest({ id: "installed-b" }), { source: "installed" });
    registry.setEnabled("installed-b", false);

    const data = registry.snapshot();
    expect(data.schemaVersion).toBe(5);
    expect(data.plugins.map((p) => p.manifest.id)).toEqual([
      "installed-a",
      "installed-b",
    ]);
    expect(
      data.plugins.find((p) => p.manifest.id === "installed-a")?.enabled,
    ).toBe(true);
    expect(
      data.plugins.find((p) => p.manifest.id === "installed-b")?.enabled,
    ).toBe(false);
  });

  it("hydrate 恢复 installed 插件与启用状态；内置同 id 跳过不报错", () => {
    const registry = new PluginRegistry();
    registry.register(manifest());

    registry.hydrate({
      schemaVersion: 5,
      plugins: [
        // 与内置同 id：跳过（内置优先），不产生加载错误。
        { manifest: manifest({ name: "Duplicate" }), enabled: false },
        { manifest: manifest({ id: "stored-a" }), enabled: false },
        { manifest: manifest({ id: "stored-b" }), enabled: true },
      ],
    });

    expect(registry.getSource("stored-a")).toBe("installed");
    expect(registry.isEnabled("stored-a")).toBe(false);
    expect(registry.isEnabled("stored-b")).toBe(true);
    expect(registry.getLoadErrors()).toHaveLength(0);
    expect(registry.list()).toHaveLength(3);
  });

  it("snapshot 后再 hydrate 保持幂等（不重复注册）", () => {
    const registry = new PluginRegistry();
    registry.register(manifest({ id: "installed-a" }), { source: "installed" });
    const data = registry.snapshot();
    registry.hydrate(data);
    expect(registry.list()).toHaveLength(1);
    expect(registry.getLoadErrors()).toHaveLength(0);
  });
});

describe("PluginRegistry 卸载（2026-09-01，ADR-044 Phase F-1）", () => {
  it("卸载 installed 插件：从列表移除 + 发 unregistered 事件 + 快照不再含它", () => {
    const registry = new PluginRegistry();
    const events: string[] = [];
    registry.subscribe((event) => events.push(event.type));
    registry.register(manifest({ id: "installed-a" }), { source: "installed" });
    expect(registry.list()).toHaveLength(1);

    const result = registry.unregister("installed-a");
    expect(result.ok).toBe(true);
    expect(registry.list()).toHaveLength(0);
    expect(events).toContain("unregistered");
    expect(registry.snapshot().plugins).toHaveLength(0);
  });

  it("builtin 插件不可卸载（PLUGIN_BUILTIN_NOT_REMOVABLE）", () => {
    const registry = new PluginRegistry();
    registry.register(manifest());
    const result = registry.unregister("example-panel");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("PLUGIN_BUILTIN_NOT_REMOVABLE");
    expect(registry.list()).toHaveLength(1);
  });

  it("未注册插件卸载返回 PLUGIN_NOT_FOUND", () => {
    const registry = new PluginRegistry();
    const result = registry.unregister("unknown");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PLUGIN_NOT_FOUND");
  });

  it("卸载时回收贡献点（getContributions 不再返回该插件贡献）", () => {
    const registry = registryWithPanels();
    registry.register(manifest({ id: "installed-a" }), { source: "installed" });
    expect(registry.getContributions("panels")).toHaveLength(1);
    registry.unregister("installed-a");
    expect(registry.getContributions("panels")).toHaveLength(0);
  });
});

describe("PluginRegistry 隔离线程运行时（2026-09-01，ADR-044 Phase F-2）", () => {
  it("installed 插件可携带 remoteRuntime 注册并激活", async () => {
    const registry = new PluginRegistry();
    const remote = fakeRemoteRuntime();
    const result = registry.register(manifest({ id: "installed-exec" }), {
      source: "installed",
      remoteRuntime: remote,
      entrySource: "export const manifest = {}",
    });
    expect(result.ok).toBe(true);
    expect(registry.getLifecycleState("installed-exec")).toBe("active");
    // 激活为异步调用（注册后触发）。
    await vi.waitFor(() => {
      expect(remote.activate).toHaveBeenCalledTimes(1);
    });
  });

  it("builtin 不可携带 remoteRuntime（仅 installed）", () => {
    const registry = new PluginRegistry();
    const result = registry.register(manifest(), {
      remoteRuntime: fakeRemoteRuntime(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PLUGIN_HOOK_FAILED");
  });

  it("remoteRuntime 激活失败 → 生命周期 failed + 贡献被禁用", async () => {
    const registry = registryWithPanels();
    const remote = fakeRemoteRuntime({
      activate: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    registry.register(manifest({ id: "installed-exec" }), {
      source: "installed",
      remoteRuntime: remote,
    });
    await vi.waitFor(() => {
      expect(registry.getLifecycleState("installed-exec")).toBe("failed");
    });
    expect(registry.getContributions("panels")).toHaveLength(0);
  });

  it("卸载时关闭远程运行时（deactivate + dispose）", async () => {
    const registry = new PluginRegistry();
    const remote = fakeRemoteRuntime();
    registry.register(manifest({ id: "installed-exec" }), {
      source: "installed",
      remoteRuntime: remote,
    });
    await vi.waitFor(() => {
      expect(remote.activate).toHaveBeenCalledTimes(1);
    });
    registry.unregister("installed-exec");
    await vi.waitFor(() => {
      expect(remote.dispose).toHaveBeenCalledTimes(1);
    });
  });

  it("快照携带 entrySource；hydrate 恢复 entrySource 但不自动激活", () => {
    const registry = new PluginRegistry();
    registry.register(manifest({ id: "installed-exec" }), {
      source: "installed",
      remoteRuntime: fakeRemoteRuntime(),
      entrySource: "export const manifest = { id: 'x' }",
    });
    const data = registry.snapshot();
    expect(data.plugins[0]?.entrySource).toBe(
      "export const manifest = { id: 'x' }",
    );

    const restored = new PluginRegistry();
    restored.hydrate(data);
    expect(restored.getSource("installed-exec")).toBe("installed");
    expect(restored.getEntrySource("installed-exec")).toBe(
      "export const manifest = { id: 'x' }",
    );
    // 执行模式随快照持久化：重启后装配方据此重建隔离运行时。
    expect(restored.getExecutionMode("installed-exec")).toBe("isolated");
    // hydrate 不自动激活（装配方 attachRemoteRuntime 后激活）。
    expect(restored.getLifecycleState("installed-exec")).toBe("registered");
  });

  it("隔离执行：注册时携带 remoteRuntime 即激活，并持久化 executionMode=isolated", async () => {
    const registry = new PluginRegistry();
    const remote = fakeRemoteRuntime();
    const result = registry.register(manifest({ id: "installed-exec" }), {
      source: "installed",
      remoteRuntime: remote,
      entrySource: "export const manifest = {}",
    });
    expect(result.ok).toBe(true);
    await vi.waitFor(() => {
      expect(remote.activate).toHaveBeenCalledTimes(1);
    });
    expect(registry.getLifecycleState("installed-exec")).toBe("active");
    expect(registry.getExecutionMode("installed-exec")).toBe("isolated");
    const stored = registry.snapshot().plugins[0];
    expect(stored?.entrySource).toBe("export const manifest = {}");
    expect(stored?.executionMode).toBe("isolated");
  });
});

describe("PluginRegistry 同进程运行时（ADR-054：手动安装 + 用户授权）", () => {
  it("installed 插件可携带同进程 runtime（用户在安装确认框中显式授权）", () => {
    const registry = new PluginRegistry();
    const activate = vi.fn();
    const result = registry.register(
      manifest({ id: "bundled-x", platform: { web: true, node: true } }),
      {
        source: "installed",
        runtime: { activate },
      },
    );
    expect(result.ok).toBe(true);
    expect(registry.getSource("bundled-x")).toBe("installed");
    expect(registry.getRuntime("bundled-x")).toBeDefined();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(registry.getLifecycleState("bundled-x")).toBe("active");
  });

  it("同进程 runtime 激活失败 → failed + 贡献禁用（错误隔离）", () => {
    const registry = new PluginRegistry();
    registry.register(
      manifest({ id: "bundled-fail", platform: { web: true, node: true } }),
      {
        source: "installed",
        runtime: {
          activate() {
            throw new Error("boom");
          },
        },
      },
    );
    expect(registry.getLifecycleState("bundled-fail")).toBe("failed");
    expect(
      registry.getLoadErrors().some((e) => e.pluginId === "bundled-fail"),
    ).toBe(true);
  });

  it("canHandleToolbarAction：runtime 声明 handler 且启用 → true；禁用/无 handler → false", () => {
    const registry = new PluginRegistry();
    const handle = vi.fn();
    registry.register(
      manifest({ id: "acts", platform: { web: true, node: true } }),
      {
        source: "installed",
        runtime: { activate() {}, handleToolbarAction: handle },
      },
    );
    expect(registry.canHandleToolbarAction("acts", "a.b")).toBe(true);
    registry.setEnabled("acts", false);
    expect(registry.canHandleToolbarAction("acts", "a.b")).toBe(false);
    expect(registry.canHandleToolbarAction("unknown", "a.b")).toBe(false);
  });

  it("invokeToolbarAction：委托 runtime handler，ctx.communication 按 pluginId 经工厂绑定", async () => {
    const communicationApiFactory = vi.fn(() => ({
      readRegisters: vi.fn(async () => ({ ok: true as const, value: [1] })),
      writeRegisters: vi.fn(async () => ({
        ok: true as const,
        value: undefined,
      })),
    }));
    const registry = new PluginRegistry({ communicationApiFactory });
    const handle = vi.fn(
      async (_actionId: string, ctx: { communication: unknown }) => {
        await (
          ctx.communication as { writeRegisters: () => Promise<unknown> }
        ).writeRegisters();
        return { ok: true as const, value: undefined };
      },
    );
    registry.register(
      manifest({ id: "acts", platform: { web: true, node: true } }),
      {
        source: "installed",
        runtime: { activate() {}, handleToolbarAction: handle },
      },
    );
    const result = await registry.invokeToolbarAction("acts", "a.b");
    expect(result.ok).toBe(true);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(communicationApiFactory).toHaveBeenCalledWith(
      "acts",
      expect.objectContaining({
        check: expect.any(Function),
        onRevoke: expect.any(Function),
      }),
    );
  });

  it("invokeToolbarAction：无 handler → PLUGIN_ACTION_NOT_HANDLED；handler 抛错 → PLUGIN_HOOK_FAILED", async () => {
    const registry = new PluginRegistry();
    registry.register(
      manifest({ id: "acts", platform: { web: true, node: true } }),
      { source: "installed", runtime: { activate() {} } },
    );
    const missing = await registry.invokeToolbarAction("acts", "a.b");
    expect(missing.ok).toBe(false);
    if (!missing.ok)
      expect(missing.error.code).toBe("PLUGIN_ACTION_NOT_HANDLED");

    registry.register(
      manifest({ id: "throws", platform: { web: true, node: true } }),
      {
        source: "installed",
        runtime: {
          activate() {},
          handleToolbarAction() {
            throw new Error("boom");
          },
        },
      },
    );
    const failed = await registry.invokeToolbarAction("throws", "a.b");
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe("PLUGIN_HOOK_FAILED");
  });

  it("同进程注册记录 executionMode=same-process 并随快照持久化（ADR-054）", () => {
    const registry = new PluginRegistry();
    const activate = vi.fn();
    registry.register(
      manifest({ id: "same-process-x", platform: { web: true, node: true } }),
      { source: "installed", runtime: { activate } },
    );
    expect(activate).toHaveBeenCalledTimes(1);
    expect(registry.getExecutionMode("same-process-x")).toBe("same-process");
    expect(registry.snapshot().plugins[0]?.executionMode).toBe("same-process");
    // 无执行面的纯清单插件不写 executionMode。
    registry.register(manifest({ id: "manifest-only" }), {
      source: "installed",
    });
    expect(registry.getExecutionMode("manifest-only")).toBeNull();
    expect(
      registry.snapshot().plugins.find((p) => p.manifest.id === "manifest-only")
        ?.executionMode,
    ).toBeUndefined();
  });

  it("ctx.registries 注入：activate 可经 ctx 注册 codec/dataType/addressTransform（ADR-054）", () => {
    const codecRegister = vi.fn(() => ok(undefined));
    const dataTypeRegister = vi.fn(() => ok(undefined));
    const transformRegister = vi.fn(() => ok(undefined));
    let captured: { pluginId: string; codecList: string[] } | null = null;
    const registry = new PluginRegistry({
      syncRegistries: {
        codec: { register: codecRegister, list: () => ["custom"] },
        dataType: {
          register: dataTypeRegister,
          get: () => undefined,
          list: () => [],
        },
        addressTransform: {
          register: transformRegister,
          get: () => undefined,
          list: () => [],
        },
      },
    });
    registry.register(
      manifest({ id: "sync-x", platform: { web: true, node: true } }),
      {
        source: "installed",
        runtime: {
          activate(ctx) {
            ctx.registries.codec.register({
              protocolId: "custom",
              encodeRead: () => new Uint8Array(),
              encodeWrite: () => new Uint8Array(),
              decodeResponse: () => ok({ kind: "write" }),
              parserFactory: () => ({ push: () => ({ done: false }) }),
              expectedLength: () => ({ normal: 1, exception: 5 }),
            });
            ctx.registries.addressTransform.register({
              id: "t1",
              protocol: "rtu",
              apply: (address: number) => ok(address - 1),
            });
            captured = {
              pluginId: ctx.pluginId,
              codecList: ctx.registries.codec.list(),
            };
          },
        },
      },
    );
    expect(captured).toEqual({ pluginId: "sync-x", codecList: ["custom"] });
    expect(codecRegister).toHaveBeenCalledTimes(1);
    expect(transformRegister).toHaveBeenCalledTimes(1);
  });

  it("未注入同步注册面时 ctx.registries 返回能力错误兜底", () => {
    const registry = new PluginRegistry();
    let errorCode: string | null = null;
    registry.register(
      manifest({ id: "sync-y", platform: { web: true, node: true } }),
      {
        source: "installed",
        runtime: {
          activate(ctx) {
            const result = ctx.registries.dataType.register("x", {
              parse: () => ok(0),
              format: () => "0",
            });
            if (!result.ok) errorCode = result.error.code;
          },
        },
      },
    );
    expect(errorCode).toBe("PLUGIN_SYNC_REGISTRY_UNAVAILABLE");
    expect(registry.getExecutionMode("sync-y")).toBe("same-process");
  });
});
