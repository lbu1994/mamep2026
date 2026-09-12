/**
 * 内置贡献点 schema 单测（2026-09-12）：`title`（方案 A 插件自带翻译）。
 * theme 与 panels 共用同一个 `LOCALIZED_TITLE_SCHEMA`（`en-US` 必填非空、`zh-CN` 可选）。
 */
import { describe, expect, it } from "vitest";
import {
  PANELS_CONTRIBUTION_SCHEMA,
  THEME_COLOR_PRESET_SCHEMA,
} from "./builtin-contribution-points";

describe("内置贡献点：插件自带翻译 title（方案 A）", () => {
  it("panels：title 可选——含 title / 不含 title 均通过", () => {
    const withTitle = PANELS_CONTRIBUTION_SCHEMA.safeParse([
      {
        id: "overview",
        titleKey: "plugins.examplePanelTitle",
        title: { "en-US": "Example Panel", "zh-CN": "示例面板" },
      },
    ]);
    expect(withTitle.success).toBe(true);

    const withoutTitle = PANELS_CONTRIBUTION_SCHEMA.safeParse([
      { id: "overview", titleKey: "plugins.examplePanelTitle" },
    ]);
    expect(withoutTitle.success).toBe(true);

    const englishOnly = PANELS_CONTRIBUTION_SCHEMA.safeParse([
      {
        id: "overview",
        titleKey: "plugins.examplePanelTitle",
        title: { "en-US": "Example Panel" },
      },
    ]);
    expect(englishOnly.success).toBe(true);
  });

  it("panels：title 缺 en-US 或为空串 → 校验失败", () => {
    expect(
      PANELS_CONTRIBUTION_SCHEMA.safeParse([
        {
          id: "overview",
          titleKey: "plugins.examplePanelTitle",
          title: { "zh-CN": "示例面板" },
        },
      ]).success,
    ).toBe(false);
    expect(
      PANELS_CONTRIBUTION_SCHEMA.safeParse([
        {
          id: "overview",
          titleKey: "plugins.examplePanelTitle",
          title: { "en-US": "" },
        },
      ]).success,
    ).toBe(false);
  });

  it("panels：id / titleKey 仍为必填非空", () => {
    expect(PANELS_CONTRIBUTION_SCHEMA.safeParse([{ id: "x" }]).success).toBe(
      false,
    );
    expect(
      PANELS_CONTRIBUTION_SCHEMA.safeParse([{ id: "", titleKey: "x" }]).success,
    ).toBe(false);
  });

  it("theme：预设 title 与 panels 共用同一校验（含 zh-CN 可选）", () => {
    expect(
      THEME_COLOR_PRESET_SCHEMA.safeParse({
        id: "indigo",
        titleKey: "plugins.exampleThemeColor",
        title: { "en-US": "Indigo", "zh-CN": "靛蓝" },
        colorPrimary: "#4f46e5",
      }).success,
    ).toBe(true);
    expect(
      THEME_COLOR_PRESET_SCHEMA.safeParse({
        id: "indigo",
        titleKey: "plugins.exampleThemeColor",
        title: { "zh-CN": "靛蓝" },
        colorPrimary: "#4f46e5",
      }).success,
    ).toBe(false);
  });
});
