import { describe, expect, it } from "vitest";
import { PluginRegistry } from "./registry";
import type { PluginManifest } from "./manifest";

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "example-panel",
    name: "Example Panel",
    version: "1.0.0",
    description: "A built-in example plugin",
    platform: { web: true, node: false },
    permissions: ["ui.panel"],
    contributions: {
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
