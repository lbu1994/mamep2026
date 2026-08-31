import { describe, expect, it } from "vitest";
import { PluginRegistry } from "./registry";
import type { PluginManifest } from "./manifest";

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "example-panel",
    name: "Example Panel",
    version: "1.0.0",
    apiVersion: "1.0",
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
    expect(data.schemaVersion).toBe(2);
    expect(data.plugins.map((p) => p.manifest.id)).toEqual([
      "installed-a",
      "installed-b",
    ]);
    expect(data.plugins.find((p) => p.manifest.id === "installed-a")?.enabled).toBe(
      true,
    );
    expect(data.plugins.find((p) => p.manifest.id === "installed-b")?.enabled).toBe(
      false,
    );
  });

  it("hydrate 恢复 installed 插件与启用状态；内置同 id 跳过不报错", () => {
    const registry = new PluginRegistry();
    registry.register(manifest());

    registry.hydrate({
      schemaVersion: 2,
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
