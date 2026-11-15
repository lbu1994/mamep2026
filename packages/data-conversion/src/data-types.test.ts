import { describe, expect, it } from "vitest";
import {
  formatRawValue,
  groupBinaryBits,
  isScaled,
  isSigned,
  parseCellText,
} from "./data-types";
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

/** 校验失败必须携带与 i18n（packages/ui/src/i18n）一致的驼峰 userMessageKey。 */
function expectParseFailMessageKey(
  text: string,
  type: DataType,
  key: string,
): void {
  const result = parseCellText(text, type);
  expect(result.ok, `type=${type} text=${text}`).toBe(false);
  if (!result.ok) expect(result.error.userMessageKey).toBe(key);
}

describe("data error userMessageKey（i18n 断链回归）", () => {
  it("hex 非法字符映射 errors.dataInvalidNumber", () => {
    expectParseFailMessageKey("zz", "hex", "errors.dataInvalidNumber");
  });

  it("hex 超过 4 位映射 errors.dataOutOfRange", () => {
    expectParseFailMessageKey("ABCDE", "hex", "errors.dataOutOfRange");
  });

  it("binary 非法字符映射 errors.dataInvalidNumber", () => {
    expectParseFailMessageKey("0b101", "binary", "errors.dataInvalidNumber");
  });

  it("binary 超过 16 位映射 errors.dataOutOfRange", () => {
    expectParseFailMessageKey(
      "11111111111111111",
      "binary",
      "errors.dataOutOfRange",
    );
  });

  it("空输入映射 errors.dataEmpty", () => {
    expectParseFailMessageKey("", "hex", "errors.dataEmpty");
  });

  it("数字格式非法映射 errors.dataInvalidNumber", () => {
    expectParseFailMessageKey("1.5", "unsigned", "errors.dataInvalidNumber");
    expectParseFailMessageKey("1e3", "unsigned", "errors.dataInvalidNumber");
  });

  it("越界映射 errors.dataOutOfRange", () => {
    expectParseFailMessageKey("65536", "unsigned", "errors.dataOutOfRange");
    expectParseFailMessageKey("-1", "unsigned", "errors.dataOutOfRange");
  });

  it("小数位超精度映射 errors.dataTooManyDecimals", () => {
    expectParseFailMessageKey(
      "12.34",
      "unsigned-0.1",
      "errors.dataTooManyDecimals",
    );
  });
});

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
  it("formats as fixed 16 bits grouped every 8 bits（ADR-051）", () => {
    expect(formatRawValue(0, "binary")).toBe("00000000 00000000");
    expect(formatRawValue(5, "binary")).toBe("00000000 00000101");
    expect(formatRawValue(0xffff, "binary")).toBe("11111111 11111111");
  });

  it("groups every 8 bits via groupBinaryBits", () => {
    expect(groupBinaryBits("0000000011111111")).toBe("00000000 11111111");
    expect(groupBinaryBits("0000000000000001")).toBe("00000000 00000001");
  });

  it("parses 1-16 bits ignoring whitespace, rejecting 0b prefix", () => {
    expectParse("101", "binary", 5);
    expectParse("1111111111111111", "binary", 0xffff);
    expectParse(" 101 ", "binary", 5);
    expectParse("00000000 00000101", "binary", 5);
    expectParse("0000\t0000\n0000 0101", "binary", 5);
  });

  it("rejects 0b prefix, non-0/1 characters, more than 16 bits and empty input", () => {
    expectParseFail("0b101", "binary", "DATA_BINARY_INVALID");
    expectParseFail("10 2", "binary", "DATA_BINARY_INVALID");
    expectParseFail("11111111111111111", "binary", "DATA_BINARY_TOO_LONG");
    expectParseFail("0000 0000 0000 0000 0", "binary", "DATA_BINARY_TOO_LONG");
    expectParseFail("", "binary", "DATA_EMPTY");
  });
});

describe("Bool type (ADR-043 E-2)", () => {
  it("formats as 0/1", () => {
    expect(formatRawValue(0, "bool")).toBe("0");
    expect(formatRawValue(1, "bool")).toBe("1");
    expect(formatRawValue(0xffff, "bool")).toBe("1");
  });

  it("parses 0 and 1 only", () => {
    expectParse("0", "bool", 0);
    expectParse("1", "bool", 1);
    expectParse(" 1 ", "bool", 1);
  });

  it("rejects non-bool input and empty", () => {
    expectParseFail("2", "bool", "DATA_BOOL_INVALID");
    expectParseFail("true", "bool", "DATA_BOOL_INVALID");
    expectParseFail("", "bool", "DATA_EMPTY");
  });

  it("is not scaled nor signed", () => {
    expect(isScaled("bool")).toBe(false);
    expect(isSigned("bool")).toBe(false);
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
