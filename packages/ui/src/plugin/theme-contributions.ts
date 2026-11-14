/**
 * theme 贡献点消费方（docs/architecture/ports/plugin-api/插件契约.md §3，ADR-047，逆转 ADR-042 任意取色）。
 * 插件经 theme 贡献点注册一个或多个可选主题色（colors[]）→ Settings 主题色选择器选项；
 * 用户选择经 workspace.preferences.themePrimary（预设 ID = `<pluginId>:<colorId>`）持久化 →
 * 装配链解析为 token 覆盖。**不再自动应用**（ADR-042「插件层最高优先」已移除）；
 * 禁用/卸载插件后解析不到 → 回退默认 Ant Design 蓝。
 */
import { theme as antdTheme, type ThemeConfig } from "antd";
import type { Contribution } from "@mamep2026/plugin-api";
import {
  pluginLocalizedTitle,
  type PluginLocalizedTitle,
} from "./plugin-title";

/** 插件注册的单条可选主题色（与 plugin-api THEME_COLOR_PRESET_SCHEMA 结构一致）。
 * 2026-09-03 方案 A：新增 `title` 插件自带翻译（en-US 必填 / zh-CN 可选），缺失语言回退英文；
 * 2026-09-12：`title` 类型改复用 `PluginLocalizedTitle`（theme / panels 共用一份解析）。
 * 2026-09-03：仅要求 `colorPrimary`（单一明亮主色），链接色跟随主色、暗色由 antd 算法派生。 */
export interface ThemeColorPreset {
  id: string;
  titleKey: string;
  title?: PluginLocalizedTitle;
  colorPrimary: string;
}

export interface ThemeContribution {
  colors?: ThemeColorPreset[];
}

/** Settings 主题色选择器选项：完整预设 ID = `<pluginId>:<colorId>`。 */
export interface ThemeColorOption {
  id: string;
  titleKey: string;
  title?: PluginLocalizedTitle;
  colorPrimary: string;
}

/** 解析主题色显示名（方案 A）：插件自带 title → 英文 → 应用 i18n titleKey → titleKey。
 * 2026-09-12：解析实现抽到 `plugin-title`（与 panels 共用），本函数行为不变。 */
export function themeColorTitle(
  option: ThemeColorOption,
  locale: string,
  t: (key: string) => string,
): string {
  return pluginLocalizedTitle(option.title, option.titleKey, locale, t);
}

/** 内置默认蓝（Ant Design 默认）哨兵值：仅作 Select 选项值，不持久化（themePrimary=null 对应）。 */
export const DEFAULT_THEME_COLOR_ID = "default";

/** 汇总各（启用）插件注册的可选主题色（按插件注册顺序扁平化）。 */
export function buildThemeColorOptions(
  contributions: readonly Contribution<ThemeContribution>[],
): ThemeColorOption[] {
  const options: ThemeColorOption[] = [];
  for (const contribution of contributions) {
    for (const preset of contribution.payload.colors ?? []) {
      options.push({
        id: `${contribution.pluginId}:${preset.id}`,
        titleKey: preset.titleKey,
        ...(preset.title !== undefined ? { title: preset.title } : {}),
        colorPrimary: preset.colorPrimary,
      });
    }
  }
  return options;
}

/** 按完整预设 ID 查找可选主题色；插件禁用/卸载后返回 null → 调用方回退默认蓝。 */
export function findThemeColorOption(
  contributions: readonly Contribution<ThemeContribution>[],
  id: string,
): ThemeColorOption | null {
  return (
    buildThemeColorOptions(contributions).find((option) => option.id === id) ??
    null
  );
}

/** 预设 → antd token 覆盖：只喂**单一明亮主色**（种子），链接色默认跟随主色；
 * 暗色主色/hover/active 由 antd 算法（ConfigProvider 的 algorithm）自动派生，不做二次派生。 */
export function themeConfigForColorOption(
  option: ThemeColorOption,
): ThemeConfig {
  return themeConfigForColorSeed(option.colorPrimary);
}

/** 色种子 → antd token 覆盖（与 `themeConfigForColorOption` 同一形态）。
 * 供「插件贡献尚未就绪」时用启动缓存里上次解析出的种子直接着色（2026-09-16）。 */
export function themeConfigForColorSeed(seed: string): ThemeConfig {
  return {
    token: {
      colorPrimary: seed,
      colorLink: seed,
    },
  };
}

/**
 * 首帧主色种子解析（2026-09-16，修复「插件主题色首帧默认蓝」）：
 * - 已解析到预设（插件贡献已就绪）→ 用预设色；
 * - 选了预设但**插件贡献尚未就绪**（插件存储读取 / activate 未完成）→ 用启动缓存里上次解析出的种子；
 * - 未选预设，或插件已就绪却解析不到（插件被禁用 / 卸载）→ null（回退默认 Ant Design 蓝）。
 *
 * `pluginsReady` 是区分「尚未加载」与「确实不存在」的唯一依据 —— 否则卸载插件后品牌色会永远停在插件色。
 */
export function resolveThemeColorSeed(
  resolvedSeed: string | null,
  options: {
    themePrimary: string | null;
    pluginsReady: boolean;
    cachedSeed: string | null;
  },
): string | null {
  if (resolvedSeed !== null) return resolvedSeed;
  if (options.themePrimary === null || options.pluginsReady) return null;
  return options.cachedSeed;
}

/** 计算当前主题模式下「派生后」的真实主色：把单一主色作为种子交给 antd 算法只读计算。
 * 仅用于 CSS 变量（--mamep-brand-primary / --mamep-focus-ring），**不喂回 ConfigProvider**，
 * 避免 antd 把派生值当种子再次二次派生（ADR-048 同款取舍）。 */
export function deriveAppliedPrimary(seed: string, dark: boolean): string {
  const token = antdTheme.getDesignToken({
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: { colorPrimary: seed, colorLink: seed },
  });
  return token.colorPrimary;
}
