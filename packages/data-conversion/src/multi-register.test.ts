import { describe, expect, it } from "vitest";
import type { Result } from "@mamep2026/domain";
import {
  allowedRegisterCounts,
  formatRawValues,
  isValidRegisterCount,
  parseCompositeText,
} from "./multi-register";

/** 断言 ok 并取出 value（Result 判别联合窄化辅助）。 */
function valueOf<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok result, got ${result.error.code}`);
  }
  return result.value;
}

describe("isValidRegisterCount / allowedRegisterCounts (ADR-030)", () => {
  it("allows 1/2/4 for signed and unsigned types", () => {
    expect(allowedRegisterCounts("unsigned")).toEqual([1, 2, 4]);
    expect(allowedRegisterCounts("signed-0.1")).toEqual([1, 2, 4]);
    expect(isValidRegisterCount("unsigned", 2)).toBe(true);
    expect(isValidRegisterCount("unsigned", 3)).toBe(false);
    expect(isValidRegisterCount("signed", 4)).toBe(true);
    expect(isValidRegisterCount("signed", 5)).toBe(false);
  });

  it("allows 1/2/3/4 for binary", () => {
    expect(allowedRegisterCounts("binary")).toEqual([1, 2, 3, 4]);
    expect(isValidRegisterCount("binary", 3)).toBe(true);
    expect(isValidRegisterCount("binary", 4)).toBe(true);
    expect(isValidRegisterCount("binary", 5)).toBe(false);
  });

  it("allows any count >= 1 for hex and string", () => {
    expect(allowedRegisterCounts("hex")).toBe("any");
    expect(allowedRegisterCounts("string")).toBe("any");
    expect(isValidRegisterCount("hex", 7)).toBe(true);
    expect(isValidRegisterCount("string", 10)).toBe(true);
    expect(isValidRegisterCount("hex", 0)).toBe(false);
  });
});

describe("formatRawValues (ADR-030)", () => {
  it("formats hex as space-separated 4-digit groups", () => {
    expect(formatRawValues([0x1234, 0xabcd], "hex")).toBe("1234 ABCD");
  });

  it("formats binary as a concatenated bit string", () => {
    expect(formatRawValues([0x0001, 0x0002], "binary")).toBe(
      "00000000000000010000000000000010",
    );
  });

  it("formats 32-bit unsigned big-endian", () => {
    expect(formatRawValues([0x0001, 0x0002], "unsigned")).toBe("65538");
  });

  it("formats 32-bit signed big-endian (two's complement)", () => {
    expect(formatRawValues([0xffff, 0xffff], "signed")).toBe("-1");
    expect(formatRawValues([0x0000, 0x0001], "signed")).toBe("1");
  });

  it("formats 64-bit unsigned without precision loss", () => {
    expect(
      formatRawValues([0xffff, 0xffff, 0xffff, 0xffff], "unsigned"),
    ).toBe("18446744073709551615");
  });

  it("formats 64-bit signed big-endian", () => {
    expect(
      formatRawValues([0xffff, 0xffff, 0xffff, 0xffff], "signed"),
    ).toBe("-1");
    expect(
      formatRawValues([0x0000, 0x0000, 0x0000, 0x0001], "signed"),
    ).toBe("1");
  });

  it("formats ASCII string (2 chars per register)", () => {
    expect(formatRawValues([0x4142, 0x4344], "string")).toBe("ABCD");
  });

  it("applies scale to the composite decimal value", () => {
    expect(formatRawValues([0x0000, 0x000a], "unsigned-0.1")).toBe("1.0");
    expect(formatRawValues([0x0000, 0x0064], "signed-0.01")).toBe("1.00");
    expect(formatRawValues([0xffff, 0xffff], "signed-0.01")).toBe("-0.01");
  });
});

describe("parseCompositeText (ADR-030)", () => {
  it("parses hex groups with optional 0x prefix and continuous form", () => {
    expect(valueOf(parseCompositeText("1234 ABCD", "hex", 2))).toEqual([
      0x1234, 0xabcd,
    ]);
    expect(valueOf(parseCompositeText("1234ABCD", "hex", 2))).toEqual([
      0x1234, 0xabcd,
    ]);
    expect(valueOf(parseCompositeText("0x1234 0xABCD", "hex", 2))).toEqual([
      0x1234, 0xabcd,
    ]);
  });

  it("rejects hex with wrong group count or invalid group", () => {
    expect(parseCompositeText("1234", "hex", 2).ok).toBe(false);
    expect(parseCompositeText("12G4 ABCD", "hex", 2).ok).toBe(false);
    expect(parseCompositeText("12345 ABCD", "hex", 2).ok).toBe(false);
  });

  it("parses binary with optional spaces and left-padding", () => {
    expect(
      valueOf(
        parseCompositeText(
          "00000000000000010000000000000010",
          "binary",
          2,
        ),
      ),
    ).toEqual([1, 2]);
    expect(
      valueOf(
        parseCompositeText(
          "0000000000000001 0000000000000010",
          "binary",
          2,
        ),
      ),
    ).toEqual([1, 2]);
    expect(valueOf(parseCompositeText("1", "binary", 2))).toEqual([0, 1]);
    expect(parseCompositeText("2", "binary", 2).ok).toBe(false);
  });

  it("parses 32-bit unsigned big-endian", () => {
    expect(valueOf(parseCompositeText("65538", "unsigned", 2))).toEqual([1, 2]);
    expect(valueOf(parseCompositeText("4294967295", "unsigned", 2))).toEqual([
      0xffff, 0xffff,
    ]);
    expect(parseCompositeText("-1", "unsigned", 2).ok).toBe(false);
    expect(parseCompositeText("4294967296", "unsigned", 2).ok).toBe(false);
  });

  it("parses 32-bit signed big-endian", () => {
    expect(valueOf(parseCompositeText("-1", "signed", 2))).toEqual([
      0xffff, 0xffff,
    ]);
    expect(valueOf(parseCompositeText("1", "signed", 2))).toEqual([0, 1]);
    expect(parseCompositeText("4294967296", "signed", 2).ok).toBe(false);
  });

  it("parses 64-bit unsigned without precision loss", () => {
    expect(
      valueOf(parseCompositeText("18446744073709551615", "unsigned", 4)),
    ).toEqual([0xffff, 0xffff, 0xffff, 0xffff]);
    expect(
      parseCompositeText("18446744073709551616", "unsigned", 4).ok,
    ).toBe(false);
  });

  it("parses ASCII string padded with spaces", () => {
    expect(valueOf(parseCompositeText("ABCD", "string", 2))).toEqual([
      0x4142, 0x4344,
    ]);
    expect(valueOf(parseCompositeText("AB", "string", 2))).toEqual([
      0x4142, 0x2020,
    ]);
    expect(valueOf(parseCompositeText("ABC", "string", 2))).toEqual([
      0x4142, 0x4320,
    ]);
    expect(parseCompositeText("ABCDE", "string", 2).ok).toBe(false);
    expect(parseCompositeText("中文", "string", 2).ok).toBe(false);
  });

  it("parses scaled composite values", () => {
    expect(valueOf(parseCompositeText("1.0", "unsigned-0.1", 2))).toEqual([
      0x0000, 0x000a,
    ]);
    expect(valueOf(parseCompositeText("-0.01", "signed-0.01", 2))).toEqual([
      0xffff, 0xffff,
    ]);
    expect(parseCompositeText("1.05", "unsigned-0.1", 2).ok).toBe(false);
  });

  it("rejects register counts not allowed for the type", () => {
    expect(parseCompositeText("1", "unsigned", 3).ok).toBe(false);
    expect(parseCompositeText("1", "binary", 5).ok).toBe(false);
    expect(parseCompositeText("00", "hex", 0).ok).toBe(false);
  });

  it("rejects empty input", () => {
    expect(parseCompositeText("   ", "unsigned", 2).ok).toBe(false);
  });
});

describe("round-trip (ADR-030)", () => {
  it("formatRawValues(parseCompositeText(text)) normalizes to display form", () => {
    const cases: Array<[string, import("@mamep2026/domain").DataType, number]> = [
      ["1234 ABCD", "hex", 2],
      ["00000000000000010000000000000010", "binary", 2],
      ["65538", "unsigned", 2],
      ["-1", "signed", 2],
      ["18446744073709551615", "unsigned", 4],
      ["-0.01", "signed-0.01", 2],
      ["ABCD", "string", 2],
    ];
    for (const [text, type, count] of cases) {
      const parsed = valueOf(parseCompositeText(text, type, count));
      expect(formatRawValues(parsed, type)).toBe(text);
    }
  });
});
