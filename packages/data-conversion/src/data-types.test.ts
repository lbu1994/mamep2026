import { describe, expect, it } from "vitest";
import { formatRawValue, parseCellText } from "./data-types";
import type { DataType } from "@mamep2026/domain";

function expectParse(text: string, type: DataType, expectedRaw: number): void {
  const result = parseCellText(text, type);
  expect(result.ok, `type=${type} text=${text}`).toBe(true);
  if (result.ok) expect(result.value).toBe(expectedRaw);
}

function expectParseFail(text: string, type: DataType, code: string): void {
  const result = parseCellText(text, type);
  expect(result.ok, `type=${type} text=${text}`).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

describe("HEX type", () => {
  it("formats as fixed 4 uppercase hex digits without 0x prefix", () => {
    expect(formatRawValue(0x00ab, "hex")).toBe("00AB");
    expect(formatRawValue(0, "hex")).toBe("0000");
  });

  it("parses with optional 0x prefix and trims whitespace", () => {
    expectParse("00AB", "hex", 0xab);
    expectParse("ab", "hex", 0xab);
    expectParse("0xAB", "hex", 0xab);
    expectParse(" ffff ", "hex", 0xffff);
  });

  it("rejects more than 4 hex digits and invalid characters", () => {
    expectParseFail("ABCDE", "hex", "DATA_HEX_TOO_LONG");
    expectParseFail("zz", "hex", "DATA_HEX_INVALID");
    expectParseFail("", "hex", "DATA_EMPTY");
  });
});

describe("Binary type", () => {
  it("formats as fixed 16 bits", () => {
    expect(formatRawValue(0, "binary")).toBe("0000000000000000");
    expect(formatRawValue(5, "binary")).toBe("0000000000000101");
    expect(formatRawValue(0xffff, "binary")).toBe("1111111111111111");
  });

  it("parses 1-16 bits without 0b prefix or inner spaces", () => {
    expectParse("101", "binary", 5);
    expectParse("1111111111111111", "binary", 0xffff);
    expectParse(" 101 ", "binary", 5);
  });

  it("rejects 0b prefix, inner spaces, more than 16 bits and empty input", () => {
    expectParseFail("0b101", "binary", "DATA_BINARY_INVALID");
    expectParseFail("10 1", "binary", "DATA_BINARY_INVALID");
    expectParseFail("11111111111111111", "binary", "DATA_BINARY_TOO_LONG");
    expectParseFail("", "binary", "DATA_EMPTY");
  });
});

describe("Unsigned Dec. type", () => {
  it("formats and parses the full 0..65535 range", () => {
    expect(formatRawValue(0, "unsigned")).toBe("0");
    expect(formatRawValue(65535, "unsigned")).toBe("65535");
    expectParse("0", "unsigned", 0);
    expectParse("65535", "unsigned", 65535);
  });

  it("rejects negatives, overflow and decimals", () => {
    expectParseFail("-1", "unsigned", "DATA_OUT_OF_RANGE");
    expectParseFail("65536", "unsigned", "DATA_OUT_OF_RANGE");
    expectParseFail("1.5", "unsigned", "DATA_INVALID_NUMBER");
    expectParseFail("1e3", "unsigned", "DATA_INVALID_NUMBER");
  });
});

describe("Signed Dec. type", () => {
  it("formats 16-bit signed interpretation", () => {
    expect(formatRawValue(0x7fff, "signed")).toBe("32767");
    expect(formatRawValue(0x8000, "signed")).toBe("-32768");
    expect(formatRawValue(0xffff, "signed")).toBe("-1");
  });

  it("parses -32768..32767 into two's complement raw values", () => {
    expectParse("32767", "signed", 0x7fff);
    expectParse("-32768", "signed", 0x8000);
    expectParse("-1", "signed", 0xffff);
  });

  it("rejects out-of-range and malformed input", () => {
    expectParseFail("32768", "signed", "DATA_OUT_OF_RANGE");
    expectParseFail("-32769", "signed", "DATA_OUT_OF_RANGE");
    expectParseFail("1.5", "signed", "DATA_INVALID_NUMBER");
  });
});

describe("Unsigned 0.1 scaled type", () => {
  it("formats raw value divided by 10 with one decimal digit", () => {
    expect(formatRawValue(123, "unsigned-0.1")).toBe("12.3");
    expect(formatRawValue(0, "unsigned-0.1")).toBe("0.0");
    expect(formatRawValue(1, "unsigned-0.1")).toBe("0.1");
  });

  it("parses decimal strings with at most one decimal digit", () => {
    expectParse("12.3", "unsigned-0.1", 123);
    expectParse("0.1", "unsigned-0.1", 1);
    expectParse("6553.5", "unsigned-0.1", 65535);
  });

  it("rejects too many decimals, scientific notation and localized decimals", () => {
    expectParseFail("12.34", "unsigned-0.1", "DATA_TOO_MANY_DECIMALS");
    expectParseFail("1e2", "unsigned-0.1", "DATA_INVALID_NUMBER");
    expectParseFail("12,3", "unsigned-0.1", "DATA_INVALID_NUMBER");
    expectParseFail("-0.1", "unsigned-0.1", "DATA_INVALID_NUMBER");
  });
});

describe("Unsigned 0.01 / 0.001 / 0.0001 scaled types", () => {
  it("formats with the configured number of decimal digits", () => {
    expect(formatRawValue(65535, "unsigned-0.01")).toBe("655.35");
    expect(formatRawValue(1500, "unsigned-0.001")).toBe("1.500");
    expect(formatRawValue(65535, "unsigned-0.0001")).toBe("6.5535");
  });

  it("parses with exact decimal places allowed", () => {
    expectParse("655.35", "unsigned-0.01", 65535);
    expectParse("1.5", "unsigned-0.01", 150);
    expectParse("65.535", "unsigned-0.001", 65535);
    expectParse("6.5535", "unsigned-0.0001", 65535);
    expectParse("0.0001", "unsigned-0.0001", 1);
  });

  it("rejects too many decimals without silent rounding", () => {
    expectParseFail("6.55351", "unsigned-0.0001", "DATA_TOO_MANY_DECIMALS");
    expectParseFail("1.234", "unsigned-0.01", "DATA_TOO_MANY_DECIMALS");
  });
});

describe("Signed scaled types", () => {
  it("formats signed scaled values", () => {
    expect(formatRawValue(0x8000, "signed-0.1")).toBe("-3276.8");
    expect(formatRawValue(0x7fff, "signed-0.1")).toBe("3276.7");
    expect(formatRawValue(0xffff, "signed-0.001")).toBe("-0.001");
  });

  it("parses negative scaled values", () => {
    expectParse("-3276.8", "signed-0.1", 0x8000);
    expectParse("-0.001", "signed-0.001", 0xffff);
    expectParse("3276.7", "signed-0.1", 0x7fff);
  });

  it("rejects out-of-range signed scaled values", () => {
    expectParseFail("3276.8", "signed-0.1", "DATA_OUT_OF_RANGE");
    expectParseFail("-3276.9", "signed-0.1", "DATA_OUT_OF_RANGE");
  });
});
