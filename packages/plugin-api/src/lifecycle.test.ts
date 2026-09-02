import { describe, expect, it, vi } from "vitest";
import { ContributionPointRegistry } from "./contributions";
import { PLUGIN_HOOK_FAILED } from "./lifecycle";
import { PluginRegistry } from "./registry";
import { BUILTIN_CONTRIBUTION_POINTS } from "./builtin-contribution-points";
import type { PluginManifest } from "./manifest";

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "lifecycle-plugin",
    name: "Lifecycle Plugin",
    version: "1.0.0",
    apiVersion: "1.0",
    description: "lifecycle test",
    requiredCapabilities: [],
    platform: { web: true, node: false },
    permissions: [],
    contributes: {},
    ...overrides,
  };
}

function makeRegistry() {
  const contributionRegistry = new ContributionPointRegistry();
  for (const point of BUILTIN_CONTRIBUTION_POINTS) {
    contributionRegistry.registerPoint(point);
  }
  return new PluginRegistry({ contributionRegistry });
}

describe("PluginRegistry 生命周期骨架（ADR-039）", () => {
  it("无 runtime 的插件生命周期为 registered", () => {
    const registry = makeRegistry();
    registry.register(manifest());
    expect(registry.getLifecycleState("lifecycle-plugin")).toBe("registered");
  });

  it("内置 runtime：register 即 activate（state active），deactivate 在禁用时调用", () => {
    const registry = makeRegistry();
    const activate = vi.fn(() => undefined);
    const deactivate = vi.fn(() => undefined);
    registry.register(manifest(), {
      runtime: { activate, deactivate },
    });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(registry.getLifecycleState("lifecycle-plugin")).toBe("active");
    registry.setEnabled("lifecycle-plugin", false);
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(registry.getLifecycleState("lifecycle-plugin")).toBe("deactivated");
  });

  it("activate 抛错 → PLUGIN_HOOK_FAILED + 贡献禁用 + 插件仍可见", () => {
    const registry = makeRegistry();
    registry.register(
      manifest({
        contributes: { panels: [{ id: "p", titleKey: "x" }] },
      }),
      {
        runtime: {
          activate() {
            throw new Error("boom");
          },
        },
      },
    );
    expect(registry.getLifecycleState("lifecycle-plugin")).toBe("failed");
    expect(registry.getLoadErrors().some((e) => e.errorCode === PLUGIN_HOOK_FAILED)).toBe(
      true,
    );
    // 故障插件贡献被禁用。
    expect(registry.getContributions("panels")).toHaveLength(0);
    expect(registry.list()).toHaveLength(1);
  });

  it("activate 异步 reject 同样隔离（PLUGIN_HOOK_FAILED）", async () => {
    const registry = makeRegistry();
    registry.register(
      manifest({ contributes: { panels: [{ id: "p", titleKey: "x" }] } }),
      {
        runtime: {
          activate() {
            return Promise.reject(new Error("async boom"));
          },
        },
      },
    );
    // 异步失败在下一次微任务/宏任务后落定。
    await vi.waitFor(() => {
      expect(registry.getLifecycleState("lifecycle-plugin")).toBe("failed");
    });
    expect(registry.getLoadErrors().some((e) => e.errorCode === PLUGIN_HOOK_FAILED)).toBe(
      true,
    );
    expect(registry.getContributions("panels")).toHaveLength(0);
  });

  it("installed 允许同进程 runtime（随包受信插件，ADR-045 放宽；第三方仍仅 remoteRuntime）", () => {
    const registry = makeRegistry();
    const result = registry.register(manifest(), {
      source: "installed",
      runtime: { activate: () => undefined },
    });
    expect(result.ok).toBe(true);
    expect(registry.getLifecycleState("lifecycle-plugin")).toBe("active");
  });

  it("getVersion 随注册/启停事件自增（UI 响应式订阅用）", () => {
    const registry = makeRegistry();
    const v0 = registry.getVersion();
    registry.register(manifest());
    expect(registry.getVersion()).toBeGreaterThan(v0);
  });
});
