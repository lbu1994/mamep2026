import { describe, expect, it } from "vitest";
import { theme as antdTheme } from "antd";
import type { ThemeConfig } from "antd";
import { mergeThemeConfig } from "./merge";

describe("mergeThemeConfig", () => {
  const base: ThemeConfig = {
    cssVar: { key: "ant" },
    algorithm: antdTheme.defaultAlgorithm,
    token: { colorPrimary: "#1460d6", fontSize: 13, colorText: "#000" },
    components: {
      Table: { rowHoverBg: "rgba(0,0,0,0.03)", headerBg: "#fff" },
      Input: { activeBorderColor: "#111" },
    },
  };

  it("token 浅合并且 override 优先；base 未覆盖字段保留", () => {
    const merged = mergeThemeConfig(base, {
      token: { colorPrimary: "#1668dc", colorBgContainer: "#101014" },
    });
    expect(merged.token?.colorPrimary).toBe("#1668dc");
    expect(merged.token?.colorBgContainer).toBe("#101014");
    expect(merged.token?.fontSize).toBe(13);
    expect(merged.token?.colorText).toBe("#000");
  });

  it("components 逐组件合并，override 优先且保留 base 同组件其他字段", () => {
    const merged = mergeThemeConfig(base, {
      components: {
        Table: { rowHoverBg: "#2a2d2e" },
      },
    });
    expect(merged.components?.Table?.rowHoverBg).toBe("#2a2d2e");
    expect(merged.components?.Table?.headerBg).toBe("#fff");
    // 未覆盖的组件原样保留。
    expect(merged.components?.Input?.activeBorderColor).toBe("#111");
  });

  it("顶层字段（algorithm/cssVar）按 override 优先，与 token/components 一致", () => {
    const merged = mergeThemeConfig(base, {
      algorithm: antdTheme.darkAlgorithm,
      cssVar: { key: "other" },
    });
    expect(merged.algorithm).toBe(antdTheme.darkAlgorithm);
    expect(merged.cssVar).toEqual({ key: "other" });
  });

  it("base.components 缺失时直接采用 overrides.components", () => {
    const merged = mergeThemeConfig(
      { token: { colorPrimary: "#1460d6" } },
      { components: { Table: { rowHoverBg: "#2a2d2e" } } },
    );
    expect(merged.components?.Table?.rowHoverBg).toBe("#2a2d2e");
  });

  it("overrides.components 缺失时保留 base.components", () => {
    const merged = mergeThemeConfig(base, { token: { fontSize: 14 } });
    expect(merged.components?.Table?.rowHoverBg).toBe("rgba(0,0,0,0.03)");
    expect(merged.token?.fontSize).toBe(14);
  });
});
