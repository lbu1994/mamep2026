import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

/**
 * Mamep2026 应用级主题（docs/AGENTS.md §25.1；2026-08-25 从 packages/ui/src/theme.ts
 * 迁入 ui-theme，packages/ui/src/theme.ts 为兼容 re-export）。
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

/**
 * 默认品牌色组（2026-09-02，ADR-048）：运行时取自 antd 公开令牌（theme.getDesignToken），
 * 不再硬编码字面量——antd 升级仅改默认色值时，本软件零代码修改即自动跟随。
 */
export interface DefaultBrandColors {
  colorPrimary: string;
  colorLink: string;
  colorLinkHover: string;
  colorLinkActive: string;
}

/**
 * 经 antd 公开 API `theme.getDesignToken({ algorithm })` 计算当前默认品牌色组：
 * 浅色 = defaultAlgorithm、暗色 = darkAlgorithm（derived token 已含 colorPrimary/colorLink 派生）。
 * 注意：返回值为「antd 以默认种子运行算法」的最终值；若把它们作为 token 覆盖再喂回
 * ConfigProvider（带 algorithm），antd 会把覆盖值当种子**二次派生**（暗色主色会被再次
 * 映射为更深的派生色），因此 buildTheme **不覆盖**品牌色 token，直接让 antd 默认种子生效
 * （本函数仅供测试/校验/文档消费）。
 */
export function getAntdDefaultBrandColors(dark: boolean): DefaultBrandColors {
  const token = antdTheme.getDesignToken(
    dark
      ? { algorithm: antdTheme.darkAlgorithm }
      : { algorithm: antdTheme.defaultAlgorithm },
  );
  return {
    colorPrimary: token.colorPrimary,
    colorLink: token.colorLink,
    colorLinkHover: token.colorLinkHover,
    colorLinkActive: token.colorLinkActive,
  };
}

export function buildTheme(dark: boolean): ThemeConfig {
  return {
    cssVar: { key: "ant" },
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      fontSize: 13,
      controlHeight: 28,
      controlHeightSM: 24,
      borderRadius: 4,
      // 品牌蓝（2026-09-02，ADR-048）：**不覆盖** colorPrimary/colorLink/colorLinkHover/
      // colorLinkActive——直接采用 antd 默认种子（当前值即 antd 默认浅/暗主色），
      // 库升级改默认色自动跟随；覆盖会造成 antd 二次派生（暗色主色被再次映射）。
      // 接受浅色白字对比度约 4.1:1（antd 默认水平）。
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
      // Comm Log 日志列表（Listy 虚拟列表）：压缩 item 纵向 padding，使日志行更紧凑。
      // Listy 内部 itemHeight = fontHeight + itemPaddingBlock*2，与 BottomPanel 的
      // logRowHeight 用同一公式，保证虚拟滚动窗口与实际行高一致（滚动位置准确）。
      Listy: {
        itemPaddingBlock: 4,
      },
    },
  };
}
