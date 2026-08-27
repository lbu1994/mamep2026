/**
 * No 列宽度自适应纯函数测试（2026-08-27）。
 * 公式：内边距(12) + 展开图标(14+4) + 间距(2) + 位数×9，且不低于最小宽 40。
 * 1 位 → 12+18+2+9=41；2 位 → 50；3 位 → 59；4 位 → 68。
 */
import { describe, expect, it } from "vitest";
import {
  computeNoColumnWidth,
  NO_COLUMN_MIN_WIDTH,
  orderDigitCount,
} from "./no-column-width";

describe("orderDigitCount", () => {
  it("空表/0 视作 1 位", () => {
    expect(orderDigitCount(0)).toBe(1);
    expect(orderDigitCount(-5)).toBe(1);
  });

  it("1~9 → 1 位，10~99 → 2 位", () => {
    expect(orderDigitCount(1)).toBe(1);
    expect(orderDigitCount(9)).toBe(1);
    expect(orderDigitCount(10)).toBe(2);
    expect(orderDigitCount(99)).toBe(2);
  });

  it("100~999 → 3 位，1000+ → 4 位", () => {
    expect(orderDigitCount(100)).toBe(3);
    expect(orderDigitCount(999)).toBe(3);
    expect(orderDigitCount(1000)).toBe(4);
    expect(orderDigitCount(9999)).toBe(4);
  });
});

describe("computeNoColumnWidth", () => {
  it("1 位行号：宽度为 41（高于最小宽 40，容纳图标 + 单字符）", () => {
    expect(computeNoColumnWidth(1)).toBe(41);
    expect(computeNoColumnWidth(9)).toBe(41);
  });

  it("2 位行号（默认 50 行场景）：宽度 50，图标 + 两位数单行放得下", () => {
    expect(computeNoColumnWidth(10)).toBe(50);
    expect(computeNoColumnWidth(50)).toBe(50);
    expect(computeNoColumnWidth(99)).toBe(50);
  });

  it("3 位 / 4 位行号：宽度随位数增长（59 / 68）", () => {
    expect(computeNoColumnWidth(100)).toBe(59);
    expect(computeNoColumnWidth(999)).toBe(59);
    expect(computeNoColumnWidth(1000)).toBe(68);
  });

  it("空表（maxOrder=0）：宽度不低于最小宽", () => {
    expect(computeNoColumnWidth(0)).toBeGreaterThanOrEqual(NO_COLUMN_MIN_WIDTH);
  });

  it("位数增长时宽度单调不减", () => {
    const widths = [1, 9, 10, 99, 100, 999, 1000, 9999].map(
      computeNoColumnWidth,
    );
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i] ?? 0).toBeGreaterThanOrEqual(widths[i - 1] ?? 0);
    }
  });
});
