import type { ThemeConfig } from "antd";
import {
  ensureContrast,
  parseColor,
  toRgbaString,
  withAlpha,
} from "./contrast";
import { pick, type VscodeThemeColors } from "./theme-colors";

/**
 * VSCode Theme Color → antd token 覆盖（叠加在 buildTheme(dark) 之上，见 build.ts）。
 *
 * 决策（2026-08-25，ADR-027）：中性色/表面色/边框/输入态/选择态跟随 VSCode 主题；
 * 品牌蓝与状态语义色（success/warning/error/link）、字号、间距、圆角来自 base 保留。
 * 文字灰阶由 editor-foreground 推导 alpha，并用 ensureContrast 保证 WCAG 2.2 AA
 * （正文/次级 ≥4.5:1，quaternary/placeholder ≥3:1），不随主题出现低对比回归。
 */

const FALLBACK_BG = { dark: "#1e1e1e", light: "#ffffff" } as const;
const FALLBACK_FG = { dark: "#d4d4d4", light: "#1f1f1f" } as const;

/** 文字灰阶 alpha 基线（与 base.ts 校准值对齐；再由 ensureContrast 做 AA 下限兜底）。 */
const TEXT_ALPHAS = {
  secondary: 0.78,
  tertiary: { dark: 0.62, light: 0.55 },
  quaternary: { dark: 0.45, light: 0.35 },
  placeholder: { dark: 0.45, light: 0.38 },
} as const;

export function mapVscodeTheme(
  colors: VscodeThemeColors,
  dark: boolean,
): ThemeConfig {
  // 表面/边框/焦点/选择态（优先语义最贴近的变量，缺失时降级回退）。
  const container = pick(colors, ["--vscode-editor-background"]);
  const layout = pick(colors, [
    "--vscode-sideBar-background",
    "--vscode-panel-background",
    "--vscode-editor-background",
  ]);
  const elevated = pick(colors, [
    "--vscode-menu-background",
    "--vscode-quickInput-background",
    "--vscode-editorWidget-background",
  ]);
  const spotlight = pick(colors, [
    "--vscode-editorWidget-background",
    "--vscode-menu-background",
  ]);
  const hover = pick(colors, ["--vscode-list-hoverBackground"]);
  const selected = pick(colors, ["--vscode-list-activeSelectionBackground"]);
  const border = pick(colors, [
    "--vscode-input-border",
    "--vscode-panel-border",
    "--vscode-sideBar-border",
  ]);
  const borderSecondary = pick(colors, [
    "--vscode-panel-border",
    "--vscode-sideBar-border",
    "--vscode-editorWidget-border",
  ]);
  const focus = pick(colors, ["--vscode-focusBorder"]);
  const foreground = pick(colors, ["--vscode-editor-foreground"]);
  const placeholder = pick(colors, ["--vscode-input-placeholderForeground"]);

  // token 只收已解析出的值（缺失回退 base，避免覆盖 base 校准值）。
  const token: Record<string, string> = {};
  const add = (key: string, value: string | undefined): void => {
    if (value !== undefined) token[key] = value;
  };

  add("colorBgLayout", layout);
  add("colorBgContainer", container);
  add("colorBgElevated", elevated);
  add("colorBgSpotlight", spotlight);
  add("colorFillTertiary", hover);
  add("colorBgTextHover", hover);
  add("colorPrimaryBg", selected);
  add("colorPrimaryBgHover", selected);
  add("colorBorder", border);
  add("colorBorderSecondary", borderSecondary);
  add("colorSplit", borderSecondary);
  add("colorPrimaryBorder", focus);
  add("colorInfo", pick(colors, ["--vscode-editorInfo-foreground"]));

  if (container !== undefined && foreground !== undefined) {
    const bg =
      parseColor(container) ??
      parseColor(dark ? FALLBACK_BG.dark : FALLBACK_BG.light);
    const fg =
      parseColor(foreground) ??
      parseColor(dark ? FALLBACK_FG.dark : FALLBACK_FG.light);
    if (bg !== null && fg !== null) {
      add("colorText", toRgbaString(fg));
      add(
        "colorTextSecondary",
        ensureContrast(withAlpha(fg, TEXT_ALPHAS.secondary), bg, 4.5),
      );
      add(
        "colorTextTertiary",
        ensureContrast(
          withAlpha(
            fg,
            dark ? TEXT_ALPHAS.tertiary.dark : TEXT_ALPHAS.tertiary.light,
          ),
          bg,
          4.5,
        ),
      );
      add(
        "colorTextQuaternary",
        ensureContrast(
          withAlpha(
            fg,
            dark ? TEXT_ALPHAS.quaternary.dark : TEXT_ALPHAS.quaternary.light,
          ),
          bg,
          3,
        ),
      );
      add(
        "colorTextPlaceholder",
        placeholder ??
          ensureContrast(
            withAlpha(
              fg,
              dark
                ? TEXT_ALPHAS.placeholder.dark
                : TEXT_ALPHAS.placeholder.light,
            ),
            bg,
            3,
          ),
      );
    }
  }

  return {
    // token 恒为非空对象（可能为空覆盖），仅收窄 antd 的 AliasToken 映射类型。
    token: token as NonNullable<ThemeConfig["token"]>,
    components: {
      Table: {
        ...(container !== undefined ? { headerBg: container } : {}),
        ...(hover !== undefined ? { rowHoverBg: hover } : {}),
        ...(borderSecondary !== undefined
          ? { borderColor: borderSecondary }
          : {}),
      },
      Input: {
        ...(focus !== undefined ? { activeBorderColor: focus } : {}),
        ...(border !== undefined ? { hoverBorderColor: border } : {}),
      },
      InputNumber: {
        ...(focus !== undefined ? { activeBorderColor: focus } : {}),
        ...(border !== undefined ? { hoverBorderColor: border } : {}),
      },
      Select: {
        ...(focus !== undefined ? { activeBorderColor: focus } : {}),
        ...(border !== undefined ? { hoverBorderColor: border } : {}),
      },
      Tooltip: {
        ...(spotlight !== undefined ? { colorBgSpotlight: spotlight } : {}),
      },
    },
  };
}
