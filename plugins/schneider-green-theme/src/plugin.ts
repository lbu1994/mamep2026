/**
 * 施耐德绿主题色插件（2026-09-08）。
 * 典型 theme 贡献点场景：把施耐德品牌绿（#009E4D）注册为 Settings → 主题色 可选预设。
 * 仅声明式贡献，无代码执行（无 runtime）；**不随包一次性安装**——需在 Plugin Manager
 * 通过「Install Plugin」手动安装本包内的 `manifest.json`（source:"installed"），
 * 遵循 ADR-045 禁止新增内置插件规范。
 * i18n（2026-09-03 方案 A）：插件经 `title` 字段自带翻译（en-US / zh-CN），
 * 缺失语言时消费方回退英文（title["en-US"]），再回退应用 i18n 的 titleKey。
 * 仅提供单一明亮模式主色（种子），暗色/链接/hover/active 由 antd 色彩算法自动派生（ADR-048）。
 */
import {
  PLUGIN_API_VERSION,
  type PluginManifest,
  type PluginRegistry,
} from "@mamep2026/plugin-api";

export const SCHNEIDER_GREEN_THEME_PLUGIN_ID = "schneider-green-theme";

export const schneiderGreenThemeManifest: PluginManifest = {
  id: SCHNEIDER_GREEN_THEME_PLUGIN_ID,
  name: "Schneider Green Theme",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  description:
    "Contributes the Schneider brand green (#009E4D) as an optional theme color preset.",
  author: "Mamep2026 Team",
  platform: { web: true, node: false },
  requiredCapabilities: [],
  permissions: ["theme"],
  contributes: {
    theme: {
      colors: [
        {
          id: "green",
          titleKey: "plugins.schneiderGreenThemeColor",
          title: { "en-US": "Schneider Green", "zh-CN": "施耐德绿" },
          colorPrimary: "#009E4D",
        },
      ],
    },
  },
};

/**
 * 注册施耐德绿主题色插件（手动安装，installed 来源）：仅声明式贡献，无 runtime。
 * 供单元测试与文档示例使用；应用装配不调用本函数（不随包一次性安装）。
 * 返回注册结果（测试断言 + 文档可检查失败）。
 */
export function registerSchneiderGreenThemePlugin(registry: PluginRegistry) {
  return registry.register(schneiderGreenThemeManifest, {
    source: "installed",
  });
}
