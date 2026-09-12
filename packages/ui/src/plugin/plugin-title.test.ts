import { describe, expect, it } from "vitest";
import { pluginLocalizedTitle } from "./plugin-title";

const translate = (key: string): string =>
  key === "plugins.examplePanelTitle" ? "Panel (app i18n)" : key;

describe("pluginLocalizedTitle（方案 A：插件自带翻译，2026-09-12 抽为通用）", () => {
  const withTitle = {
    "en-US": "Example Panel",
    "zh-CN": "示例面板",
  };

  it("当前语言命中时用该语言", () => {
    expect(
      pluginLocalizedTitle(
        withTitle,
        "plugins.examplePanelTitle",
        "zh-CN",
        translate,
      ),
    ).toBe("示例面板");
    expect(
      pluginLocalizedTitle(
        withTitle,
        "plugins.examplePanelTitle",
        "en-US",
        translate,
      ),
    ).toBe("Example Panel");
  });

  it("当前语言缺失（zh-CN 未提供）时回退英文", () => {
    expect(
      pluginLocalizedTitle(
        { "en-US": "Example Panel" },
        "plugins.examplePanelTitle",
        "zh-CN",
        translate,
      ),
    ).toBe("Example Panel");
  });

  it("未知语言回退英文", () => {
    expect(
      pluginLocalizedTitle(
        withTitle,
        "plugins.examplePanelTitle",
        "ja-JP",
        translate,
      ),
    ).toBe("Example Panel");
  });

  it("无 title 时回退应用 i18n 的 titleKey；i18n 未命中则原样返回 key", () => {
    expect(
      pluginLocalizedTitle(
        undefined,
        "plugins.examplePanelTitle",
        "zh-CN",
        translate,
      ),
    ).toBe("Panel (app i18n)");
    expect(
      pluginLocalizedTitle(
        undefined,
        "plugins.unknownTitleKey",
        "zh-CN",
        translate,
      ),
    ).toBe("plugins.unknownTitleKey");
  });
});
