/**
 * 示例面板插件（2026-09-02，插件外部化：自 apps/web/src/App.tsx 内联移出）。
 * Manifest v2，演示 panels 贡献点（底部面板「插件」页签）。
 * 2026-09-03：theme 贡献已剥离到独立插件 `plugins/example-theme`（@mamep2026/example-theme），
 * 本插件仅保留 panels；移除 "theme" 权限。
 * 仅声明式贡献，无代码执行（无 runtime）；随应用分发，首次启动一次性安装（installed 来源）。
 */
import type { PluginManifest, PluginRegistry } from "@mamep2026/plugin-api";

export const EXAMPLE_PANEL_PLUGIN_ID = "example-panel";

export const examplePanelManifest: PluginManifest = {
  id: EXAMPLE_PANEL_PLUGIN_ID,
  name: "Example Panel",
  version: "1.0.0",
  apiVersion: "1.0",
  description:
    "A UI-safe example plugin that validates the plugin boundary (panels).",
  author: "Mamep2026 Team",
  platform: { web: true, node: false },
  requiredCapabilities: [],
  permissions: ["ui-contribution"],
  contributes: {
    panels: [{ id: "example-info", titleKey: "plugins.exampleTitle" }],
  },
};

/**
 * 注册示例面板插件（随应用分发，installed 来源）：仅声明式贡献，无 runtime。
 * 由应用装配点（apps/web App.tsx）在启动时（一次性安装流程）调用。
 * 返回注册结果（测试断言 + 装配点可检查失败）。
 */
export function registerExamplePlugin(registry: PluginRegistry) {
  return registry.register(examplePanelManifest, { source: "installed" });
}
