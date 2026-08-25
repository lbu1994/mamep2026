import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor } from "./contrast";
import { mapVscodeTheme } from "./map";
import type { VscodeThemeColors } from "./theme-colors";

/** 暗色金样：近似 VSCode Dark Modern 的取色输入。 */
const DARK_COLORS: VscodeThemeColors = {
  "--vscode-editor-background": "#1e1e1e",
  "--vscode-editor-foreground": "#d4d4d4",
  "--vscode-sideBar-background": "#181818",
  "--vscode-panel-background": "#181818",
  "--vscode-menu-background": "#1e1e1e",
  "--vscode-editorWidget-background": "#252526",
  "--vscode-list-hoverBackground": "#2a2d2e",
  "--vscode-list-activeSelectionBackground": "#094771",
  "--vscode-input-border": "#3c3c3c",
  "--vscode-panel-border": "#3c3c3c",
  "--vscode-focusBorder": "#007fd4",
  "--vscode-input-placeholderForeground": "#9d9d9d",
};

/** 浅色金样：近似 VSCode Light Modern 的取色输入。 */
const LIGHT_COLORS: VscodeThemeColors = {
  "--vscode-editor-background": "#ffffff",
  "--vscode-editor-foreground": "#1f1f1f",
  "--vscode-sideBar-background": "#f3f3f3",
  "--vscode-panel-background": "#f3f3f3",
  "--vscode-menu-background": "#ffffff",
  "--vscode-editorWidget-background": "#f3f3f3",
  "--vscode-list-hoverBackground": "#e8e8e8",
  "--vscode-list-activeSelectionBackground": "#0060c0",
  "--vscode-input-border": "#cecece",
  "--vscode-panel-border": "#d4d4d4",
  "--vscode-focusBorder": "#007fd4",
};

describe("mapVscodeTheme（暗色）", () => {
  const theme = mapVscodeTheme(DARK_COLORS, true);
  const token = theme.token ?? {};

  it("表面色跟随 VSCode：容器=editor-background、布局=sideBar-background", () => {
    expect(token.colorBgContainer).toBe("#1e1e1e");
    expect(token.colorBgLayout).toBe("#181818");
  });

  it("文字主色=editor-foreground；灰阶经 AA 下限兜底", () => {
    expect(token.colorText).toBe("rgb(212, 212, 212)");
    const bg = parseColor("#1e1e1e")!;
    for (const text of [
      token.colorText as string,
      token.colorTextSecondary as string,
      token.colorTextTertiary as string,
    ]) {
      const parsed = parseColor(text);
      expect(parsed).not.toBeNull();
      expect(contrastRatio(parsed!, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("placeholder 优先用 input-placeholderForeground", () => {
    expect(token.colorTextPlaceholder).toBe("#9d9d9d");
  });

  it("品牌/状态语义色不覆盖（保留 base 值）", () => {
    expect(token.colorPrimary).toBeUndefined();
    expect(token.colorSuccess).toBeUndefined();
    expect(token.colorError).toBeUndefined();
  });

  it("边框/焦点/选择态跟随 VSCode", () => {
    expect(token.colorBorder).toBe("#3c3c3c");
    expect(token.colorPrimaryBorder).toBe("#007fd4");
    expect(token.colorPrimaryBg).toBe("#094771");
    expect(token.colorSplit).toBe("#3c3c3c");
  });

  it("组件覆盖：Table 悬停行、Input 焦点边框", () => {
    const components = theme.components ?? {};
    expect(components.Table?.rowHoverBg).toBe("#2a2d2e");
    expect(components.Table?.headerBg).toBe("#1e1e1e");
    expect(components.Input?.activeBorderColor).toBe("#007fd4");
  });
});

describe("mapVscodeTheme（浅色）", () => {
  const theme = mapVscodeTheme(LIGHT_COLORS, false);
  const token = theme.token ?? {};

  it("表面色跟随 VSCode；文字灰阶 AA 达标", () => {
    expect(token.colorBgContainer).toBe("#ffffff");
    expect(token.colorText).toBe("rgb(31, 31, 31)");
    const bg = parseColor("#ffffff")!;
    const secondary = parseColor(token.colorTextSecondary as string)!;
    expect(contrastRatio(secondary, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("组件覆盖跟随浅色输入", () => {
    expect(theme.components?.Table?.rowHoverBg).toBe("#e8e8e8");
    expect(theme.components?.Input?.activeBorderColor).toBe("#007fd4");
  });
});

describe("mapVscodeTheme（缺省回退）", () => {
  it("无 VSCode 变量时返回空覆盖（不覆盖 base）", () => {
    const theme = mapVscodeTheme({}, true);
    expect(theme.token).toEqual({});
    expect(theme.components?.Table).toEqual({});
    expect(theme.components?.Input).toEqual({});
  });

  it("部分变量缺失时只产出已解析的 token", () => {
    const theme = mapVscodeTheme(
      { "--vscode-editor-background": "#101014" },
      true,
    );
    const token = theme.token ?? {};
    expect(token.colorBgContainer).toBe("#101014");
    // foreground 缺失 → 不产出文字灰阶（回退 base）。
    expect(token.colorText).toBeUndefined();
  });
});
