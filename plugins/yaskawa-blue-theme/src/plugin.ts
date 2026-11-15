/**
 * 安川蓝主题色插件。
 * 典型 theme 贡献点场景：把安川品牌蓝（#005BB6）注册为 Settings → 主题色可选预设。
 * 仅声明式贡献，无代码执行（无 runtime）；**不随包一次性安装**——需在 Plugin Manager
 * 通过「Install Plugin」手动安装本包内的 `manifest.json`（source:"installed"），
 * 插件由用户手动安装，不随应用内置。
 * i18n（方案 A）：插件经 `title` 字段自带翻译（en-US / zh-CN），
 * 缺失语言时消费方回退英文（title["en-US"]），再回退应用 i18n 的 titleKey。
 * 仅提供单一明亮模式主色（种子），暗色/链接/hover/active 由 antd 色彩算法自动派生。
 */
import {
  PLUGIN_API_VERSION,
  type PluginManifest,
  type PluginRegistry,
} from "@mamep2026/plugin-api";

export const YASKAWA_BLUE_THEME_PLUGIN_ID = "yaskawa-blue-theme";

export const yaskawaBlueThemeManifest: PluginManifest = {
  id: YASKAWA_BLUE_THEME_PLUGIN_ID,
  name: "Yaskawa Blue Theme",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  description:
    "Contributes the Yaskawa brand blue (#005BB6) as an optional theme color preset.",
  author: "Mamep2026 Team",
  platform: { web: true, node: false },
  requiredCapabilities: [],
  permissions: ["theme"],
  contributes: {
    theme: {
      colors: [
        {
          id: "blue",
          titleKey: "plugins.yaskawaBlueThemeColor",
          title: { "en-US": "Yaskawa Blue", "zh-CN": "安川蓝" },
          colorPrimary: "#005BB6",
        },
      ],
    },
  },
};

/**
 * 注册安川蓝主题色插件（手动安装，installed 来源）：仅声明式贡献，无 runtime。
 * 供单元测试与文档示例使用；应用装配不调用本函数（不随包一次性安装）。
 * 返回注册结果（测试断言 + 文档可检查失败）。
 */
export function registerYaskawaBlueThemePlugin(registry: PluginRegistry) {
  return registry.register(yaskawaBlueThemeManifest, { source: "installed" });
}
