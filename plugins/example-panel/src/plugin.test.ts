import { describe, expect, it } from "vitest";
import {
  BUILTIN_CONTRIBUTION_POINTS,
  ContributionPointRegistry,
  PluginRegistry,
} from "@mamep2026/plugin-api";
import {
  EXAMPLE_PANEL_PLUGIN_ID,
  examplePanelManifest,
  registerExamplePlugin,
} from "./plugin";

function makeRegistry() {
  const contributionRegistry = new ContributionPointRegistry();
  for (const point of BUILTIN_CONTRIBUTION_POINTS) {
    contributionRegistry.registerPoint(point);
  }
  return new PluginRegistry({ contributionRegistry });
}

describe("example-panel 插件（2026-09-02 插件外部化）", () => {
  it("注册成功：installed 来源、无 runtime、panels + theme 贡献（manifest 自 App.tsx 移出）", () => {
    const registry = makeRegistry();
    const result = registerExamplePlugin(registry);
    expect(result.ok).toBe(true);
    expect(registry.getSource(EXAMPLE_PANEL_PLUGIN_ID)).toBe("installed");
    expect(registry.getRuntime(EXAMPLE_PANEL_PLUGIN_ID)).toBeUndefined();
    expect(registry.getLifecycleState(EXAMPLE_PANEL_PLUGIN_ID)).toBe(
      "registered",
    );

    expect(registry.list()).toHaveLength(1);
    expect(examplePanelManifest.contributes.panels).toEqual([
      { id: "example-info", titleKey: "plugins.exampleTitle" },
    ]);
    const theme = examplePanelManifest.contributes.theme;
    expect(theme?.colorPrimary?.light).toBe("#4f46e5");
  });
});
