import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

/**
 * Mamep2026 应用级主题（docs/AGENTS.md §25.1）。
 *
 * 基于 antd 默认 / 暗色算法，叠加面向工业调试工具的紧凑、专业 token：
 * - 双字体角色（设计令牌）：
 *   - UI_FONT_STACK：界面字体（导航/标题/按钮/标签页/设置/说明/Name/Comment），系统无衬线栈；
 *   - MONO_FONT_STACK：数据字体（寄存器地址/Data/日志时间/原始报文/协议字段/功能码），等宽栈。
 *   全局 fontFamily 使用 UI 字体；数据区由 --mamep-font-mono / .register-table__cell--mono
 *   等列级类切换为等宽。
 * - 字号 13、控件高 28 / 小控件 24、圆角 4 —— 提高信息密度
 * - 紧凑间距 token（padding/margin 2~16）—— 对标 Mamep2026_Demo 高密度间距体系
 * - 主色仅用于关键操作 / 选中态 / 有效反馈
 * - colorBgLayout 略低于 colorBgContainer，让页面背景与工作区形成轻微层次
 * - 文字灰阶（tertiary/quaternary/disabled/placeholder）做 WCAG 2.2 AA 方向校准，
 *   实测见 scripts/check-contrast.mjs：浅色 tertiary 0.45→0.55（≈4.7:1），
 *   暗色 tertiary 0.45→0.62、quaternary 0.25→0.45，避免辅助文字低对比。
 *
 * 开启 cssVar 后 antd 输出 --ant-* CSS 变量（含 --ant-font-family），
 * 供 index.css 统一取色/取字体（浅/深主题自动适配）。
 */
export const UI_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, ' +
  '"PingFang SC", "Microsoft YaHei", sans-serif';

export const MONO_FONT_STACK =
  'ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, Menlo, ' +
  '"PingFang SC", "Microsoft YaHei", monospace';

export function buildTheme(dark: boolean): ThemeConfig {
  return {
    cssVar: { key: "ant" },
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      fontSize: 13,
      controlHeight: 28,
      controlHeightSM: 24,
      borderRadius: 4,
      // 品牌蓝（scripts/check-contrast.mjs 实测）：
      // - 浅色 #1460d6：白字主按钮 ≈5.7:1（AA）
      // - 暗色 #1668dc（antd 暗色默认主色，更亮，在深底上可读）
      // - colorLink：暗色用更亮的 #6ba1ff，保证链接/品牌文字在深底上 ≥4.5:1
      colorPrimary: dark ? "#1668dc" : "#1460d6",
      colorLink: dark ? "#6ba1ff" : "#1460d6",
      colorLinkHover: dark ? "#8cb8ff" : "#4096ff",
      colorLinkActive: dark ? "#4a8ff7" : "#0958d9",
      // 状态色（浅色加深以保证图形对象 ≥3:1，暗色用 antd 暗色派生态）：
      colorSuccess: dark ? "#49aa19" : "#389e0d",
      colorWarning: dark ? "#d89614" : "#c08a00",
      colorError: dark ? "#dc4446" : "#cf1322",
      colorBgLayout: dark ? "#101014" : "#f2f3f5",
      // 界面字体（无衬线）；数据区单独切等宽（见 index.css 字体角色规则）。
      fontFamily: UI_FONT_STACK,
      // 文字灰阶可读性校准（辅助文字/时间/行数/版本信息等低对比风险点）。
      colorTextTertiary: dark ? "rgba(255,255,255,0.62)" : "rgba(0,0,0,0.55)",
      colorTextQuaternary: dark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.35)",
      colorTextDisabled: dark ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.42)",
      colorTextPlaceholder: dark
        ? "rgba(255,255,255,0.45)"
        : "rgba(0,0,0,0.38)",
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
