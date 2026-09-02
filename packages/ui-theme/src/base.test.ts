/**
 * 默认主题色运行时跟随 Ant Design（ADR-048）单测。
 * 验证：
 * - getAntdDefaultBrandColors 与 antd 公开 API theme.getDesignToken({ algorithm }) 一致（浅/深）；
 * - 模拟 antd 默认色变化（仅颜色值）→ 本软件取值自动跟随（无需改代码）；
 * - buildTheme **不覆盖** 品牌色 token（antd 默认种子直接生效，避免二次派生）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { theme as antdTheme } from "antd";
import { buildTheme, getAntdDefaultBrandColors } from "./base";

const BRAND_KEYS = [
  "colorPrimary",
  "colorLink",
  "colorLinkHover",
  "colorLinkActive",
] as const;

describe("getAntdDefaultBrandColors（ADR-048：运行时取自 antd 公开令牌）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("浅色 = theme.getDesignToken({ algorithm: defaultAlgorithm }) 对应字段", () => {
    const token = antdTheme.getDesignToken({
      algorithm: antdTheme.defaultAlgorithm,
    });
    expect(getAntdDefaultBrandColors(false)).toEqual({
      colorPrimary: token.colorPrimary,
      colorLink: token.colorLink,
      colorLinkHover: token.colorLinkHover,
      colorLinkActive: token.colorLinkActive,
    });
  });

  it("暗色 = theme.getDesignToken({ algorithm: darkAlgorithm }) 对应字段", () => {
    const token = antdTheme.getDesignToken({
      algorithm: antdTheme.darkAlgorithm,
    });
    expect(getAntdDefaultBrandColors(true)).toEqual({
      colorPrimary: token.colorPrimary,
      colorLink: token.colorLink,
      colorLinkHover: token.colorLinkHover,
      colorLinkActive: token.colorLinkActive,
    });
  });

  it("模拟 antd 默认色变化（仅改颜色值、不改 API）：取值自动跟随，无需修改本软件代码", () => {
    const changedToken = {
      colorPrimary: "#123456",
      colorLink: "#123456",
      colorLinkHover: "#234567",
      colorLinkActive: "#345678",
    };
    const spy = vi
      .spyOn(antdTheme, "getDesignToken")
      .mockReturnValue(
        changedToken as unknown as ReturnType<typeof antdTheme.getDesignToken>,
      );
    expect(getAntdDefaultBrandColors(false)).toEqual(changedToken);
    expect(spy).toHaveBeenCalledWith({
      algorithm: antdTheme.defaultAlgorithm,
    });
    // 暗色路径同样跟随。
    expect(getAntdDefaultBrandColors(true).colorPrimary).toBe("#123456");
    expect(spy).toHaveBeenLastCalledWith({
      algorithm: antdTheme.darkAlgorithm,
    });
  });
});

describe("buildTheme（ADR-048：默认品牌色不硬编码、不覆盖）", () => {
  it("token 不含品牌色覆盖键——antd 默认种子直接生效（避免二次派生）", () => {
    for (const dark of [false, true]) {
      const keys = Object.keys(buildTheme(dark).token ?? {});
      for (const key of BRAND_KEYS) {
        expect(keys).not.toContain(key);
      }
    }
  });

  it("算法跟随浅/深（defaultAlgorithm / darkAlgorithm），cssVar 保持 ant", () => {
    expect(buildTheme(false).algorithm).toBe(antdTheme.defaultAlgorithm);
    expect(buildTheme(true).algorithm).toBe(antdTheme.darkAlgorithm);
    expect(buildTheme(false).cssVar).toEqual({ key: "ant" });
  });
});
