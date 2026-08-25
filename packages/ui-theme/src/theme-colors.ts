/**
 * VSCode Theme Color 数据源（ui-theme，纯函数，无 DOM 依赖；ADR-027）。
 *
 * VSCode Webview 会把当前主题解析后的真实颜色以 --vscode-* CSS 自定义属性注入文档：
 * - 生产：Webview 主 frame 直接可用（getComputedStyle(root)）；
 * - dev：共享 UI 在 <iframe> 内，CSS 变量不跨文档 —— 由 dev 桥把主 frame 的变量物化到
 *   iframe 文档（apps/web/src/vscode-dev-bridge.ts + apps/vscode-extension/src/webview/html.ts），
 *   之后应用与生产走同一读取路径。
 */

/** 需要读取/转发的 --vscode-* 变量清单。dev 中继脚本（html.ts）与此保持一致。 */
export const VSCODE_CSS_VAR_NAMES = [
  "--vscode-editor-background",
  "--vscode-editor-foreground",
  "--vscode-editor-selectionBackground",
  "--vscode-sideBar-background",
  "--vscode-panel-background",
  "--vscode-menu-background",
  "--vscode-quickInput-background",
  "--vscode-editorWidget-background",
  "--vscode-list-hoverBackground",
  "--vscode-list-activeSelectionBackground",
  "--vscode-input-background",
  "--vscode-input-border",
  "--vscode-input-placeholderForeground",
  "--vscode-focusBorder",
  "--vscode-panel-border",
  "--vscode-sideBar-border",
  "--vscode-editorWidget-border",
  "--vscode-descriptionForeground",
  "--vscode-editorError-foreground",
  "--vscode-editorWarning-foreground",
  "--vscode-editorInfo-foreground",
] as const;

export type VscodeCssVarName = (typeof VSCODE_CSS_VAR_NAMES)[number];

/** 读取到的一组 VSCode 主题色（缺失/空值的变量不出现）。 */
export type VscodeThemeColors = Partial<Record<VscodeCssVarName, string>>;

/** CSS 自定义属性读取源（避免 ui-theme 依赖 DOM；Webview 传 getComputedStyle(root)）。 */
export interface CssVarSource {
  getPropertyValue(property: string): string;
}

/** 读取 --vscode-* 变量；空值/缺失的变量不进结果。 */
export function readVscodeCssVars(source: CssVarSource): VscodeThemeColors {
  const colors: VscodeThemeColors = {};
  for (const name of VSCODE_CSS_VAR_NAMES) {
    const value = source.getPropertyValue(name).trim();
    if (value !== "") colors[name] = value;
  }
  return colors;
}

/** 从 colors 取第一个存在的变量值；全部缺失返回 fallback。 */
export function pick(
  colors: VscodeThemeColors,
  names: readonly VscodeCssVarName[],
  fallback?: string,
): string | undefined {
  for (const name of names) {
    const value = colors[name];
    if (value !== undefined) return value;
  }
  return fallback;
}
