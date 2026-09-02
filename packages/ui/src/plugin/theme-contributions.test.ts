import { describe, expect, it } from "vitest";
import {
  buildThemeColorOptions,
  DEFAULT_THEME_COLOR_ID,
  findThemeColorOption,
  themeConfigForColorOption,
  type ThemeContribution,
} from "./theme-contributions";
import type { Contribution } from "@mamep2026/plugin-api";

function contribution(
  pluginId: string,
  payload: ThemeContribution,
): Contribution<ThemeContribution> {
  return { pluginId, payload };
}

describe("theme 贡献消费方（ADR-047：注册可选主题色）", () => {
  it("无贡献 → 空选项", () => {
    expect(buildThemeColorOptions([])).toEqual([]);
  });

  it("多色注册：扁平化为 `<pluginId>:<colorId>`，保留顺序", () => {
    const options = buildThemeColorOptions([
      contribution("p1", {
        colors: [
          {
            id: "indigo",
            titleKey: "plugins.p1Indigo",
            colorPrimary: { light: "#4f46e5", dark: "#818cf8" },
          },
          {
            id: "teal",
            titleKey: "plugins.p1Teal",
            colorPrimary: { light: "#0d9488", dark: "#2dd4bf" },
          },
        ],
      }),
      contribution("p2", {
        colors: [
          {
            id: "amber",
            titleKey: "plugins.p2Amber",
            colorPrimary: { light: "#d97706", dark: "#fbbf24" },
            colorLink: { light: "#d97706", dark: "#fbbf24" },
          },
        ],
      }),
    ]);
    expect(options).toEqual([
      {
        id: "p1:indigo",
        titleKey: "plugins.p1Indigo",
        colorPrimary: { light: "#4f46e5", dark: "#818cf8" },
      },
      {
        id: "p1:teal",
        titleKey: "plugins.p1Teal",
        colorPrimary: { light: "#0d9488", dark: "#2dd4bf" },
      },
      {
        id: "p2:amber",
        titleKey: "plugins.p2Amber",
        colorPrimary: { light: "#d97706", dark: "#fbbf24" },
        colorLink: { light: "#d97706", dark: "#fbbf24" },
      },
    ]);
  });

  it("findThemeColorOption：按完整预设 ID 查找；未找到/插件禁用后返回 null", () => {
    const contributions = [
      contribution("p1", {
        colors: [
          {
            id: "indigo",
            titleKey: "plugins.p1Indigo",
            colorPrimary: { light: "#4f46e5", dark: "#818cf8" },
          },
        ],
      }),
    ];
    expect(findThemeColorOption(contributions, "p1:indigo")?.id).toBe(
      "p1:indigo",
    );
    expect(findThemeColorOption(contributions, "p1:nope")).toBeNull();
    expect(findThemeColorOption([], "p1:indigo")).toBeNull();
  });

  it("themeConfigForColorOption：按 dark 模式取对应值；无 colorLink 不覆盖", () => {
    const option = {
      id: "p1:indigo",
      titleKey: "plugins.p1Indigo",
      colorPrimary: { light: "#4f46e5", dark: "#818cf8" },
      colorLink: { light: "#4f46e5", dark: "#818cf8" },
    };
    expect(themeConfigForColorOption(option, false)).toEqual({
      token: { colorPrimary: "#4f46e5", colorLink: "#4f46e5" },
    });
    expect(themeConfigForColorOption(option, true)).toEqual({
      token: { colorPrimary: "#818cf8", colorLink: "#818cf8" },
    });

    const noLink = {
      id: "p2:amber",
      titleKey: "plugins.p2Amber",
      colorPrimary: { light: "#d97706", dark: "#fbbf24" },
    };
    expect(themeConfigForColorOption(noLink, false)).toEqual({
      token: { colorPrimary: "#d97706" },
    });
  });

  it("DEFAULT_THEME_COLOR_ID 为内置默认蓝哨兵（无冒号，不与插件 ID 冲突）", () => {
    expect(DEFAULT_THEME_COLOR_ID).toBe("default");
  });
});
