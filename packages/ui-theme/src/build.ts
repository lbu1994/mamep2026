import type { ThemeConfig } from "antd";
import { buildTheme } from "./base";
import { mapVscodeTheme } from "./map";
import { mergeThemeConfig } from "./merge";
import type { VscodeThemeColors } from "./theme-colors";

/**
 * VSCode 完整主题：base（品牌/状态/字号/间距/圆角）+ VSCode 中性令牌覆盖。
 * 供 VscodeAppHost 装配（apps/web/src/vscode-app-host.ts，ADR-027）。
 * 浏览器 / Electron 仍直接消费 buildTheme（本函数不参与）。
 */
export function buildVscodeTheme(
  colors: VscodeThemeColors,
  dark: boolean,
): ThemeConfig {
  return mergeThemeConfig(buildTheme(dark), mapVscodeTheme(colors, dark));
}
