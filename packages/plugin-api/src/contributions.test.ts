import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ContributionPointRegistry,
  PLUGIN_CONTRIBUTION_INVALID,
  PLUGIN_CONTRIBUTION_POINT_EXISTS,
  PLUGIN_CONTRIBUTION_UNKNOWN,
} from "./contributions";

const PANELS_SCHEMA = z.array(z.object({ id: z.string(), titleKey: z.string() }));
const THEME_SCHEMA = z.object({ colorPrimary: z.string().optional() });

describe("ContributionPointRegistry（ADR-039：贡献点注册表）", () => {
  it("注册贡献点后可校验并登记插件贡献", () => {
    const registry = new ContributionPointRegistry();
    expect(registry.registerPoint({ id: "panels", schema: PANELS_SCHEMA }).ok).toBe(
      true,
    );
    expect(registry.hasPoint("panels")).toBe(true);
    const errors = registry.addContributions("p1", {
      panels: [{ id: "info", titleKey: "x" }],
    });
    expect(errors).toEqual([]);
    const contributions = registry.getContributions<{ id: string; titleKey: string }>("panels");
    expect(contributions).toHaveLength(1);
    expect(contributions[0]?.pluginId).toBe("p1");
    // panels 贡献的 payload 即声明数组本身。
    expect(contributions[0]?.payload).toEqual([{ id: "info", titleKey: "x" }]);
  });

  it("重复注册贡献点 → PLUGIN_CONTRIBUTION_POINT_EXISTS", () => {
    const registry = new ContributionPointRegistry();
    registry.registerPoint({ id: "panels", schema: PANELS_SCHEMA });
    const result = registry.registerPoint({ id: "panels", schema: PANELS_SCHEMA });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PLUGIN_CONTRIBUTION_POINT_EXISTS);
    }
  });

  it("未登记贡献点 → PLUGIN_CONTRIBUTION_UNKNOWN，不影响已登记点", () => {
    const registry = new ContributionPointRegistry();
    registry.registerPoint({ id: "theme", schema: THEME_SCHEMA });
    const errors = registry.addContributions("p1", {
      theme: { colorPrimary: "#fff" },
      unknownPoint: { anything: true },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.errorCode).toBe(PLUGIN_CONTRIBUTION_UNKNOWN);
    expect(errors[0]?.pointId).toBe("unknownPoint");
    // 已登记点仍生效。
    expect(registry.getContributions("theme")).toHaveLength(1);
  });

  it("payload 不合法 → PLUGIN_CONTRIBUTION_INVALID", () => {
    const registry = new ContributionPointRegistry();
    registry.registerPoint({ id: "panels", schema: PANELS_SCHEMA });
    const errors = registry.addContributions("p1", { panels: "not-an-array" });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.errorCode).toBe(PLUGIN_CONTRIBUTION_INVALID);
  });

  it("禁用/移除插件的贡献被过滤（getContributions）", () => {
    const registry = new ContributionPointRegistry();
    registry.registerPoint({ id: "theme", schema: THEME_SCHEMA });
    registry.addContributions("p1", { theme: { colorPrimary: "#111" } });
    registry.addContributions("p2", { theme: { colorPrimary: "#222" } });
    expect(registry.getContributions("theme")).toHaveLength(2);
    registry.setContributionsActive("p1", false);
    const active = registry.getContributions("theme");
    expect(active).toHaveLength(1);
    expect(active[0]?.pluginId).toBe("p2");
    registry.removePluginContributions("p2");
    expect(registry.getContributions("theme")).toHaveLength(0);
  });
});
