import { describe, expect, it } from "vitest";
import {
  blend,
  contrastRatio,
  ensureContrast,
  parseColor,
  relativeLuminance,
  toRgbaString,
  withAlpha,
} from "./contrast";

describe("parseColor", () => {
  it("解析 #rgb / #rrggbb", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#1460d6")).toEqual({
      r: 0x14,
      g: 0x60,
      b: 0xd6,
      a: 1,
    });
  });

  it("解析 rgb()/rgba()", () => {
    expect(parseColor("rgb(255, 0, 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("rgba(0, 0, 0, 0.5)")).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0.5,
    });
  });

  it("不支持/非法输入返回 null", () => {
    expect(parseColor("")).toBeNull();
    expect(parseColor("red")).toBeNull();
    expect(parseColor("#12345")).toBeNull();
  });
});

describe("对比度", () => {
  it("黑白对比度 21:1，相同颜色 1:1", () => {
    const white = parseColor("#ffffff")!;
    const black = parseColor("#000000")!;
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
    expect(relativeLuminance(black)).toBeCloseTo(0, 5);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
    expect(contrastRatio(black, black)).toBeCloseTo(1, 5);
  });

  it("blend 按 alpha 混合到背景", () => {
    const fg = withAlpha(parseColor("#000000")!, 0.5);
    const bg = parseColor("#ffffff")!;
    const blended = blend(fg, bg);
    expect(blended).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
  });
});

describe("ensureContrast", () => {
  it("半透明前景不足 AA 时提升 alpha 直到达标", () => {
    const fg = withAlpha(parseColor("#000000")!, 0.3);
    const bg = parseColor("#ffffff")!;
    const out = ensureContrast(fg, bg, 4.5);
    const parsed = parseColor(out);
    expect(parsed).not.toBeNull();
    // 提升后与背景的对比度必须 ≥4.5。
    expect(contrastRatio(parsed!, bg)).toBeGreaterThanOrEqual(4.5);
    expect(parsed!.a).toBeGreaterThan(0.3);
  });

  it("已达标的前景保持原 alpha（返回 rgba 字符串）", () => {
    const fg = withAlpha(parseColor("#000000")!, 1);
    const bg = parseColor("#ffffff")!;
    const out = ensureContrast(fg, bg, 4.5);
    expect(out).toBe("rgb(0, 0, 0)");
  });
});

describe("toRgbaString", () => {
  it("不透明输出 rgb()，半透明输出 rgba()", () => {
    expect(toRgbaString({ r: 1, g: 2, b: 3, a: 1 })).toBe("rgb(1, 2, 3)");
    expect(toRgbaString({ r: 1, g: 2, b: 3, a: 0.5 })).toBe(
      "rgba(1, 2, 3, 0.5)",
    );
  });
});
