import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ContributionPointRegistry,
  PLUGIN_CONTRIBUTION_INVALID,
  PLUGIN_CONTRIBUTION_POINT_EXISTS,
  PLUGIN_CONTRIBUTION_UNKNOWN,
} from "./contributions";
import { THEME_CONTRIBUTION_SCHEMA } from "./builtin-contribution-points";

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

describe("THEME_CONTRIBUTION_SCHEMA（ADR-047：多色数组；2026-09-03 方案 A：title 多语言）", () => {
  it("接受一个或多个可选主题色（colors[]，仅需单一明亮主色）", () => {
    const parsed = THEME_CONTRIBUTION_SCHEMA.parse({
      colors: [
        {
          id: "indigo",
          titleKey: "plugins.exampleThemeColor",
          title: { "en-US": "Indigo", "zh-CN": "靛蓝" },
          colorPrimary: "#4f46e5",
        },
        {
          id: "teal",
          titleKey: "plugins.exampleThemeTeal",
          colorPrimary: "#0d9488",
        },
      ],
    });
    expect(parsed.colors).toHaveLength(2);
    // 方案 A：插件自带 title；zh-CN 可选，缺失时消费方回退英文。
    expect(parsed.colors?.[0]?.title?.["en-US"]).toBe("Indigo");
    expect(parsed.colors?.[0]?.title?.["zh-CN"]).toBe("靛蓝");
  });

  it("colors 缺省合法（空贡献 = 不注册可选色）", () => {
    expect(THEME_CONTRIBUTION_SCHEMA.parse({}).colors).toBeUndefined();
  });

  it("非法：color 缺少 colorPrimary → 拒绝", () => {
    const result = THEME_CONTRIBUTION_SCHEMA.safeParse({
      colors: [{ id: "x", titleKey: "k" }],
    });
    expect(result.success).toBe(false);
  });

  it("非法：preset 缺 id/titleKey → 拒绝", () => {
    const result = THEME_CONTRIBUTION_SCHEMA.safeParse({
      colors: [
        { colorPrimary: "#fff" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("非法：title 缺 en-US → 拒绝（方案 A 英文必填）", () => {
    const result = THEME_CONTRIBUTION_SCHEMA.safeParse({
      colors: [
        {
          id: "indigo",
          titleKey: "k",
          title: { "zh-CN": "靛蓝" },
          colorPrimary: "#4f46e5",
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
