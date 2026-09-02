/**
 * theme 贡献点消费方（docs/插件功能设计.md §4.4，ADR-047，逆转 ADR-042 任意取色）。
 * 插件经 theme 贡献点注册一个或多个可选主题色（colors[]）→ Settings 主题色选择器选项；
 * 用户选择经 workspace.preferences.themePrimary（预设 ID = `<pluginId>:<colorId>`）持久化 →
 * 装配链解析为 token 覆盖。**不再自动应用**（ADR-042「插件层最高优先」已移除）；
 * 禁用/卸载插件后解析不到 → 回退默认 Ant Design 蓝。
 */
import type { ThemeConfig } from "antd";
import type { Contribution } from "@mamep2026/plugin-api";

/** 插件注册的单条可选主题色（与 plugin-api THEME_COLOR_PRESET_SCHEMA 结构一致）。 */
export interface ThemeColorPreset {
  id: string;
  titleKey: string;
  colorPrimary: { light: string; dark: string };
  colorLink?: { light: string; dark: string };
}

export interface ThemeContribution {
  colors?: ThemeColorPreset[];
}

/** Settings 主题色选择器选项：完整预设 ID = `<pluginId>:<colorId>`。 */
export interface ThemeColorOption {
  id: string;
  titleKey: string;
  colorPrimary: { light: string; dark: string };
  colorLink?: { light: string; dark: string };
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
        colorPrimary: preset.colorPrimary,
        ...(preset.colorLink !== undefined
          ? { colorLink: preset.colorLink }
          : {}),
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

/** 预设 → antd token 覆盖（按当前主题模式取 light/dark 两态；无 colorLink 不覆盖）。 */
export function themeConfigForColorOption(
  option: ThemeColorOption,
  dark: boolean,
): ThemeConfig | null {
  const mode = dark ? "dark" : "light";
  const colorPrimary = option.colorPrimary[mode];
  const colorLink = option.colorLink?.[mode];
  return {
    token: {
      colorPrimary,
      ...(colorLink !== undefined ? { colorLink } : {}),
    },
  };
}
