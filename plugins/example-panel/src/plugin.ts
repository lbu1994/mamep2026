/**
 * 示例面板插件（2026-09-02，插件外部化：自 apps/web/src/App.tsx 内联移出）。
 * 原 ADR-039 内置示例插件：Manifest v2，演示两个贡献点——panels（底部面板「插件」页签）
 * 与 theme（ADR-047：注册一个可选主题色「靛蓝」供用户选择；不再自动应用，Settings 选择器展示）。
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
    "A UI-safe example plugin that validates the plugin boundary (panels + theme color presets).",
  author: "Mamep2026 Team",
  platform: { web: true, node: false },
  requiredCapabilities: [],
  permissions: ["ui-contribution", "theme"],
  contributes: {
    panels: [{ id: "example-info", titleKey: "plugins.exampleTitle" }],
    theme: {
      colors: [
        {
          id: "indigo",
          titleKey: "plugins.exampleThemeColor",
          colorPrimary: { light: "#4f46e5", dark: "#818cf8" },
          colorLink: { light: "#4f46e5", dark: "#818cf8" },
        },
      ],
    },
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
