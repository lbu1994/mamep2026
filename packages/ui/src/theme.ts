import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

/**
 * Mamep2026 应用级主题（docs/AGENTS.md §25.1）。
 *
 * 基于 antd 默认 / 暗色算法，叠加面向工业调试工具的紧凑、专业 token：
 * - 全局等宽字体：antd 组件经 ConfigProvider 继承，body 等非 antd 元素经
 *   --ant-font-family 继承，拉丁字符按列对齐，CJK 兜底中文字体
 * - 字号 13、控件高 28 / 小控件 24、圆角 4 —— 提高信息密度
 * - 紧凑间距 token（padding/margin 2~16）—— 对标 Mamep2026_Demo 高密度间距体系
 * - 主色仅用于关键操作 / 选中态 / 有效反馈
 * - colorBgLayout 略低于 colorBgContainer，让页面背景与工作区形成轻微层次
 *
 * 开启 cssVar 后 antd 输出 --ant-* CSS 变量（含 --ant-font-family），
 * 供 index.css 统一取色/取字体（浅/深主题自动适配）。
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
      // 紧凑间距体系（对标 Mamep2026_Demo）：区块 padding 12/8、元素 gap 8、紧凑 2~4
      padding: 12,
      paddingSM: 8,
      paddingXS: 4,
      paddingXXS: 2,
      paddingLG: 16,
      margin: 12,
      marginSM: 8,
      marginXS: 4,
      marginXXS: 2,
      marginLG: 16,
      // 全局等宽字体：拉丁字符走等宽栈（地址/数值按列对齐阅读），
      // 栈尾保留中文字体兜底，保证中文正常渲染。
      fontFamily:
        'ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, Menlo, ' +
        '"PingFang SC", "Microsoft YaHei", monospace',
    },
    components: {
      Layout: {
        headerBg: "transparent",
        siderBg: "transparent",
      },
      Table: {
        headerSplitColor: "transparent",
        cellPaddingBlockSM: 2,
        cellPaddingInlineSM: 6,
        rowHoverBg: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)",
      },
      Form: {
        itemMarginBottom: 12,
      },
      Card: {
        bodyPaddingSM: 8,
      },
      Tabs: {
        horizontalItemPadding: "6px 0",
        horizontalItemGutter: 16,
      },
      Button: {
        paddingInlineSM: 9,
        contentFontSizeSM: 12,
        onlyIconSizeSM: 12,
      },
    },
  };
}
