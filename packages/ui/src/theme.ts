import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

/**
 * Mamep2026 应用级主题（docs/AGENTS.md §25.1）。
 *
 * 基于 antd 默认 / 暗色算法，叠加面向工业调试工具的紧凑、专业 token：
 * - 字号 13、控件高 28 / 小控件 24、圆角 4 —— 提高信息密度
 * - 主色仅用于关键操作 / 选中态 / 有效反馈
 * - colorBgLayout 略低于 colorBgContainer，让页面背景与工作区形成轻微层次
 *
 * 开启 cssVar 后 antd 输出 --ant-* CSS 变量，供 index.css 统一取色（浅/深主题自动适配）。
 */
export function buildTheme(dark: boolean): ThemeConfig {
  return {
    cssVar: { key: "ant" },
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      fontSize: 13,
      controlHeight: 28,
      controlHeightSM: 24,
      borderRadius: 4,
      colorPrimary: "#1677ff",
      colorBgLayout: dark ? "#101014" : "#f2f3f5",
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', " +
        "'Hiragino Sans GB', 'Microsoft YaHei', Roboto, sans-serif",
    },
    components: {
      Layout: {
        headerBg: "transparent",
        siderBg: "transparent",
        bodyBg: "transparent",
      },
      Table: {
        headerSplitColor: "transparent",
        cellPaddingBlockSM: 6,
        cellPaddingInlineSM: 8,
        rowHoverBg: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)",
      },
      Tabs: {
        horizontalItemPadding: "6px 0",
        horizontalItemGutter: 20,
      },
      Button: {
        paddingInlineSM: 9,
        contentFontSizeSM: 12,
        onlyIconSizeSM: 12,
      },
    },
  };
}
