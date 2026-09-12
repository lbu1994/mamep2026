import { describe, expect, it } from "vitest";
import {
  BUILTIN_CONTRIBUTION_POINTS,
  ContributionPointRegistry,
  PANELS_CONTRIBUTION_SCHEMA,
  PluginRegistry,
} from "@mamep2026/plugin-api";
import {
  EXAMPLE_PANEL_PLUGIN_ID,
  examplePanelManifest,
  registerExamplePanelPlugin,
} from "./plugin";

function makeRegistry() {
  const contributionRegistry = new ContributionPointRegistry();
  for (const point of BUILTIN_CONTRIBUTION_POINTS) {
    contributionRegistry.registerPoint(point);
  }
  return new PluginRegistry({ contributionRegistry });
}

describe("example-panel 插件（panels 贡献示例，2026-09-12）", () => {
  it("注册成功：installed 来源、无 runtime、panels 贡献（含插件自带 title 多语言）", () => {
    const registry = makeRegistry();
    const result = registerExamplePanelPlugin(registry);
    expect(result.ok).toBe(true);
    expect(registry.getSource(EXAMPLE_PANEL_PLUGIN_ID)).toBe("installed");
    expect(registry.getRuntime(EXAMPLE_PANEL_PLUGIN_ID)).toBeUndefined();
    expect(registry.getLifecycleState(EXAMPLE_PANEL_PLUGIN_ID)).toBe(
      "registered",
    );
    expect(registry.list()).toHaveLength(1);

    // 面板贡献经贡献点 schema 校验取类型。
    const panels = PANELS_CONTRIBUTION_SCHEMA.parse(
      examplePanelManifest.contributes.panels,
    );
    expect(panels).toHaveLength(1);
    expect(panels[0]?.id).toBe("overview");
    expect(panels[0]?.titleKey).toBe("plugins.examplePanelTitle");
    // 方案 A（2026-09-12）：插件自带 i18n title；缺失语言回退英文。
    expect(panels[0]?.title?.["en-US"]).toBe("Example Panel");
    expect(panels[0]?.title?.["zh-CN"]).toBe("示例面板");
  });

  it("permissions 声明 ui-contribution（面板/UI 贡献权限）", () => {
    expect(examplePanelManifest.permissions).toEqual(["ui-contribution"]);
  });
});
