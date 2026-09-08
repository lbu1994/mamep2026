import { describe, expect, it } from "vitest";
import {
  BUILTIN_CONTRIBUTION_POINTS,
  ContributionPointRegistry,
  PluginRegistry,
  THEME_CONTRIBUTION_SCHEMA,
} from "@mamep2026/plugin-api";
import {
  SCHNEIDER_GREEN_THEME_PLUGIN_ID,
  schneiderGreenThemeManifest,
  registerSchneiderGreenThemePlugin,
} from "./plugin";

function makeRegistry() {
  const contributionRegistry = new ContributionPointRegistry();
  for (const point of BUILTIN_CONTRIBUTION_POINTS) {
    contributionRegistry.registerPoint(point);
  }
  return new PluginRegistry({ contributionRegistry });
}

describe("schneider-green-theme 插件（2026-09-08）", () => {
  it("注册成功：installed 来源、无 runtime、theme 贡献（含插件自带 title 多语言）", () => {
    const registry = makeRegistry();
    const result = registerSchneiderGreenThemePlugin(registry);
    expect(result.ok).toBe(true);
    expect(registry.getSource(SCHNEIDER_GREEN_THEME_PLUGIN_ID)).toBe("installed");
    expect(registry.getRuntime(SCHNEIDER_GREEN_THEME_PLUGIN_ID)).toBeUndefined();
    expect(registry.getLifecycleState(SCHNEIDER_GREEN_THEME_PLUGIN_ID)).toBe(
      "registered",
    );
    expect(registry.list()).toHaveLength(1);

    // 主题色贡献（ADR-047）：注册为「可选主题色」数组；经贡献点 schema 校验取类型。
    const theme = THEME_CONTRIBUTION_SCHEMA.parse(
      schneiderGreenThemeManifest.contributes.theme,
    );
    expect(theme.colors).toHaveLength(1);
    expect(theme.colors?.[0]?.id).toBe("green");
    expect(theme.colors?.[0]?.titleKey).toBe("plugins.schneiderGreenThemeColor");
    // 方案 A（2026-09-03）：插件自带 i18n title；缺失语言回退英文。
    expect(theme.colors?.[0]?.title?.["en-US"]).toBe("Schneider Green");
    expect(theme.colors?.[0]?.title?.["zh-CN"]).toBe("施耐德绿");
    // 2026-09-03：仅需单一明亮主色（种子）；暗色/hover/active 由 antd 算法派生。
    expect(theme.colors?.[0]?.colorPrimary).toBe("#009E4D");
    expect("colorLink" in (theme.colors?.[0] as Record<string, unknown>)).toBe(
      false,
    );
  });

  it("permissions 声明 theme（主题色权限）", () => {
    expect(schneiderGreenThemeManifest.permissions).toEqual(["theme"]);
  });
});
