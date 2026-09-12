/**
 * panels 贡献示例插件（2026-09-12，补 ADR-054 §7.5 遗留：`panels` 无示例插件）。
 * 演示 `panels` 贡献点：注册一个声明式面板，显示在**底部面板的「Plugins」页签**内。
 * 仅声明式贡献，**无代码执行**（无 runtime / 无 entry，不需要「同进程执行」授权）；
 * **不随包分发**——需在 Settings → Plugins 手动安装本包内的 `manifest.json`（source:"installed"）。
 * i18n（方案 A，2026-09-12）：插件经 `title` 字段自带翻译（en-US 必填 / zh-CN 可选），
 * 缺失语言由消费方回退英文，再回退应用 i18n 的 `titleKey`。
 */
import {
  PLUGIN_API_VERSION,
  type PluginManifest,
  type PluginRegistry,
} from "@mamep2026/plugin-api";

export const EXAMPLE_PANEL_PLUGIN_ID = "example-panel";

export const examplePanelManifest: PluginManifest = {
  id: EXAMPLE_PANEL_PLUGIN_ID,
  name: "Example Panel",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  description:
    "An example plugin that demonstrates contributing a declarative panel via the panels contribution point.",
  author: "Mamep2026 Team",
  platform: { web: true, node: false },
  requiredCapabilities: [],
  permissions: ["ui-contribution"],
  contributes: {
    panels: [
      {
        id: "overview",
        titleKey: "plugins.examplePanelTitle",
        title: { "en-US": "Example Panel", "zh-CN": "示例面板" },
      },
    ],
  },
};

/**
 * 注册 panels 示例插件（手动安装，installed 来源）：仅声明式贡献，无 runtime。
 * 供单元测试与文档示例使用；应用装配不调用本函数（插件一律由用户手动安装，ADR-054）。
 * 返回注册结果（测试断言 + 文档可检查失败）。
 */
export function registerExamplePanelPlugin(registry: PluginRegistry) {
  return registry.register(examplePanelManifest, { source: "installed" });
}
