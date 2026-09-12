/**
 * 主题色示例插件（2026-09-03，自 example-panel 剥离）。
 * 演示 theme 贡献点：注册一个可选主题色「靛蓝」供用户选择（不再自动应用，Settings 选择器展示）。
 * 仅声明式贡献，无代码执行（无 runtime）；**不随包一次性安装**——需在 Plugin Manager
 * 通过「Install Plugin」手动安装本包内的 `manifest.json`（source:"installed"）。
 * i18n（2026-09-03 方案 A）：插件经 `title` 字段自带翻译（en-US / zh-CN），
 * 缺失语言时消费方回退英文（title["en-US"]），再回退应用 i18n 的 titleKey。
 */
import {
  PLUGIN_API_VERSION,
  type PluginManifest,
  type PluginRegistry,
} from "@mamep2026/plugin-api";

export const EXAMPLE_THEME_PLUGIN_ID = "example-theme";

export const exampleThemeManifest: PluginManifest = {
  id: EXAMPLE_THEME_PLUGIN_ID,
  name: "Example Theme",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  description:
    "An example plugin that demonstrates contributing an optional theme color preset via the theme contribution point.",
  author: "Mamep2026 Team",
  platform: { web: true, node: false },
  requiredCapabilities: [],
  permissions: ["theme"],
  contributes: {
    theme: {
      colors: [
        {
          id: "indigo",
          titleKey: "plugins.exampleThemeColor",
          title: { "en-US": "Indigo", "zh-CN": "靛蓝" },
          colorPrimary: "#4f46e5",
        },
      ],
    },
  },
};

/**
 * 注册主题色示例插件（手动安装，installed 来源）：仅声明式贡献，无 runtime。
 * 供单元测试与文档示例使用；应用装配不调用本函数（不随包一次性安装）。
 * 返回注册结果（测试断言 + 文档可检查失败）。
 */
export function registerExampleThemePlugin(registry: PluginRegistry) {
  return registry.register(exampleThemeManifest, { source: "installed" });
}
