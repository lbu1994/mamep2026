import { describe, expect, it } from "vitest";
import { type Result } from "@mamep2026/domain";
import { decodeFloatWords, formatFloatWords } from "./floating-point";
import { parseCellText } from "./data-types";
import {
  formatRawValues,
  isValidRegisterCount,
  parseCompositeText,
} from "./multi-register";

function valueOf<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

describe("IEEE 754 floating-point conversion", () => {
  it.each([
    ["float32", "1", [0x3f80, 0]],
    ["float32", "-2.5", [0xc020, 0]],
    ["float32", "0.1", [0x3dcc, 0xcccd]],
    ["float32", "-0", [0x8000, 0]],
    ["float32", "3.4028234663852886e38", [0x7f7f, 0xffff]],
    ["float32", "1.401298464324817e-45", [0, 1]],
    ["float32", "1.1754943508222875e-38", [0x0080, 0]],
    ["float64", "1", [0x3ff0, 0, 0, 0]],
    ["float64", "-2.5", [0xc004, 0, 0, 0]],
    ["float64", "0.1", [0x3fb9, 0x9999, 0x9999, 0x999a]],
    ["float64", "-0", [0x8000, 0, 0, 0]],
    ["float64", "1.7976931348623157e308", [0x7fef, 0xffff, 0xffff, 0xffff]],
    ["float64", "5e-324", [0, 0, 0, 1]],
    ["float64", "2.2250738585072014e-308", [0x0010, 0, 0, 0]],
    ["float64", "9007199254740993", [0x4340, 0, 0, 0]],
  ])(
    "parses %s %s to known big-endian words and round-trips",
    (type, text, words) => {
      const parsed = parseCompositeText(text, type, words.length);
      expect(valueOf(parsed)).toEqual(words);
      const formatted = formatRawValues(words, type);
      expect(
        valueOf(parseCompositeText(formatted, type, words.length)),
      ).toEqual(words);
    },
  );

  it("rounds binary32 midpoints once, ties to even", () => {
    expect(
      valueOf(parseCompositeText("1.000000059604644775390625", "float32", 2)),
    ).toEqual([0x3f80, 0]);
    expect(
      valueOf(parseCompositeText("1.000000059604644775390626", "float32", 2)),
    ).toEqual([0x3f80, 1]);
    expect(
      valueOf(parseCompositeText("1.000000178813934326171875", "float32", 2)),
    ).toEqual([0x3f80, 2]);
    expect(
      valueOf(parseCompositeText("-1.000000059604644775390626", "float32", 2)),
    ).toEqual([0xbf80, 1]);
  });

  it.each(["float32", "float64"] as const)(
    "rejects invalid text, non-finite values and invalid widths for %s",
    (type) => {
      const count = type === "float32" ? 2 : 4;
      for (const text of [
        "",
        "NaN",
        "Infinity",
        "-Infinity",
        "0x10",
        "1,2",
        "1e",
        "1e9999",
        "1e-9999",
      ]) {
        expect(parseCompositeText(text, type, count).ok, text).toBe(false);
      }
      for (const width of [0, 1, 2, 3, 4, 5]) {
        expect(isValidRegisterCount(type, width)).toBe(width === count);
        expect(parseCompositeText("1", type, width).ok).toBe(width === count);
      }
      expect(parseCellText("1", type).ok).toBe(false);
      expect(decodeFloatWords([1], type).ok).toBe(false);
      expect(decodeFloatWords(Array(count).fill(-1), type).ok).toBe(false);
    },
  );

  it("rejects float32 overflow and underflow and accepts signed zero", () => {
    for (const text of ["3.5e38", "-3.5e38", "1e-46", "-1e-46"]) {
      expect(parseCompositeText(text, "float32", 2).ok).toBe(false);
    }
    expect(valueOf(parseCompositeText("-0.000e-9999", "float32", 2))).toEqual([
      0x8000, 0,
    ]);
    expect(formatRawValues([0x8000, 0], "float32")).toBe("-0");
    expect(formatRawValues([0x3dcc, 0xcccd], "float32")).toBe(
      "0.10000000149011612",
    );
  });

  it("rejects non-finite device bit patterns", () => {
    for (const words of [
      [0x7f80, 0],
      [0xff80, 0],
      [0x7fc0, 1],
    ]) {
      expect(formatFloatWords(words, "float32").ok).toBe(false);
    }
    for (const words of [
      [0x7ff0, 0, 0, 0],
      [0xfff0, 0, 0, 0],
      [0x7ff8, 0, 0, 1],
    ]) {
      expect(formatFloatWords(words, "float64").ok).toBe(false);
    }
  });

  it("round-trips a deterministic sample of finite positive and negative bit patterns", () => {
    let seed = 0x12345678;
    function nextWord(): number {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 16;
    }
    for (const type of ["float32", "float64"] as const) {
      const count = type === "float32" ? 2 : 4;
      for (let sampleIndex = 0; sampleIndex < 300; sampleIndex += 1) {
        const words = Array.from({ length: count }, nextWord);
        const formatted = formatFloatWords(words, type);
        if (formatted.ok)
          expect(
            valueOf(parseCompositeText(formatted.value, type, count)),
          ).toEqual(words);
      }
    }
  });
});
