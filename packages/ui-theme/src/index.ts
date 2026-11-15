/**
 * @mamep2026/ui-theme —— 平台主题适配层。
 * 依赖方向：ui-theme → antd；packages/ui → ui-theme（base 反向 re-export）；apps/* → ui-theme。无环。
 */
export { buildTheme, UI_FONT_STACK, MONO_FONT_STACK } from "./base";
export {
  VSCODE_CSS_VAR_NAMES,
  readVscodeCssVars,
  pick,
  type CssVarSource,
  type VscodeCssVarName,
  type VscodeThemeColors,
} from "./theme-colors";
export {
  blend,
  contrastRatio,
  ensureContrast,
  isWhiteOnPrimaryAa,
  parseColor,
  relativeLuminance,
  toRgbaString,
  withAlpha,
  type Color,
} from "./contrast";
export { mapVscodeTheme } from "./map";
export { mergeThemeConfig } from "./merge";
export { buildVscodeTheme } from "./build";
