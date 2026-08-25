import { describe, expect, it } from "vitest";
import { pick, readVscodeCssVars, VSCODE_CSS_VAR_NAMES } from "./theme-colors";
import type { CssVarSource } from "./theme-colors";

function sourceOf(values: Record<string, string>): CssVarSource {
  return {
    getPropertyValue: (property: string) => values[property] ?? "",
  };
}

describe("readVscodeCssVars", () => {
  it("读取已定义的变量并跳过空值", () => {
    const colors = readVscodeCssVars(
      sourceOf({
        "--vscode-editor-background": "#101014",
        "--vscode-editor-foreground": "",
        "--vscode-focusBorder": "  #007fd4  ",
      }),
    );
    expect(colors["--vscode-editor-background"]).toBe("#101014");
    expect(colors["--vscode-editor-foreground"]).toBeUndefined();
    expect(colors["--vscode-focusBorder"]).toBe("#007fd4");
  });

  it("覆盖全部 VSCODE_CSS_VAR_NAMES 清单", () => {
    const colors = readVscodeCssVars(sourceOf({}));
    expect(Object.keys(colors)).toEqual([]);
    // 清单必须包含核心取色变量（dev 中继脚本依赖同一清单）。
    expect(VSCODE_CSS_VAR_NAMES).toContain("--vscode-editor-background");
    expect(VSCODE_CSS_VAR_NAMES).toContain("--vscode-editor-foreground");
    expect(VSCODE_CSS_VAR_NAMES).toContain("--vscode-focusBorder");
    expect(VSCODE_CSS_VAR_NAMES).toContain("--vscode-list-hoverBackground");
  });
});

describe("pick", () => {
  it("取第一个存在的变量", () => {
    const colors = {
      "--vscode-editor-background": "#111111",
      "--vscode-sideBar-background": "#222222",
    };
    expect(
      pick(colors, [
        "--vscode-sideBar-background",
        "--vscode-editor-background",
      ]),
    ).toBe("#222222");
  });

  it("全部缺失回退 fallback", () => {
    const colors = {
      "--vscode-editor-background": "#111111",
    };
    expect(pick(colors, ["--vscode-focusBorder"], "#ffffff")).toBe("#ffffff");
    expect(pick(colors, ["--vscode-focusBorder"])).toBeUndefined();
  });
});
