/**
 * Data 单元格提交用例测试（TDD，docs/AGENTS.md §17/§23）。
 * 对称于 address.ts 的 commitAddress：校验失败返回结构化错误、保留输入（由调用方回写）；
 * 成功提交写回规范显示文本（ADR-051，2026-09-11：与设备读回后格式化同源）。
 */
import { describe, expect, it } from "vitest";
import { createEmptyRow, type DataType } from "@mamep2026/domain";
import { createDataTypeResolver } from "@mamep2026/data-conversion";
import { canonicalCellText, commitCellText } from "./cell-text";

function makeRow(dataType: DataType) {
  return { ...createEmptyRow(), dataType, cellText: "" };
}

function makeRowWithCount(dataType: DataType, registerCount: number) {
  return { ...createEmptyRow(), dataType, registerCount, cellText: "" };
}

describe("commitCellText", () => {
  it("提交合法值：更新 cellText 并返回新行（不改原行）", () => {
    const row = makeRow("unsigned");
    const result = commitCellText(row, "42");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cellText).toBe("42");
      expect(result.value).not.toBe(row);
      expect(row.cellText).toBe("");
    }
  });

  it("成功提交写回规范显示文本（ADR-051：去空格、去 0x 前缀、补零大写）", () => {
    const row = makeRow("hex");
    const result = commitCellText(row, " ab ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.cellText).toBe("00AB");
  });

  it("非法值：返回结构化错误（DATA_INVALID_NUMBER），行不变", () => {
    const row = makeRow("unsigned");
    const result = commitCellText(row, "zz");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DATA_INVALID_NUMBER");
      expect(result.error.category).toBe("validation");
    }
    expect(row.cellText).toBe("");
  });

  it("空输入：返回 DATA_EMPTY", () => {
    const row = makeRow("hex");
    const result = commitCellText(row, "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATA_EMPTY");
  });

  it("超范围：返回 DATA_OUT_OF_RANGE（signed 上界）", () => {
    const row = makeRow("signed");
    const result = commitCellText(row, "32768");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATA_OUT_OF_RANGE");
  });

  it("小数位超精度：返回 DATA_TOO_MANY_DECIMALS", () => {
    const row = makeRow("unsigned-0.1");
    const result = commitCellText(row, "12.34");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATA_TOO_MANY_DECIMALS");
  });

  it("ADR-043 E-3：插件类型经 resolver 解析（缺省仅内置时失败）", () => {
    const row = makeRow("my-plugin:speed" as DataType);
    // 无 resolver：DATA_UNSUPPORTED_TYPE。
    const without = commitCellText(row, "1500");
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.error.code).toBe("DATA_UNSUPPORTED_TYPE");

    // 注入 resolver（注册插件处理函数）后成功。
    const resolver = createDataTypeResolver();
    resolver.register("my-plugin:speed", {
      parse: (text) =>
        ({ ok: true as const, value: Number(text) || 0 }) as const,
      format: (raw) => `${raw} rpm`,
    });
    const withResolver = commitCellText(row, "1500", resolver);
    expect(withResolver.ok).toBe(true);
    if (withResolver.ok) expect(withResolver.value.cellText).toBe("1500 rpm");
  });
});

describe("canonicalCellText（ADR-051：提交/粘贴后规范化）", () => {
  const singleCases: Array<[DataType, string, string]> = [
    ["hex", " ab ", "00AB"],
    ["hex", "0xAB", "00AB"],
    ["hex", "1f", "001F"],
    ["unsigned", "0005", "5"],
    ["unsigned", "+7", "7"],
    ["signed", "+5", "5"],
    ["signed", "-1", "-1"],
    ["unsigned-0.1", "12", "12.0"],
    ["unsigned-0.1", "0", "0.0"],
    ["signed-0.01", "-0.5", "-0.50"],
    ["binary", "101", "00000000 00000101"],
    ["binary", "00000000 00000101", "00000000 00000101"],
    ["bool", "1", "1"],
    ["string", "A", "A "],
    ["string", "AB", "AB"],
  ];
  it.each(singleCases)("单寄存器 %s：%s → %s", (type, input, expected) => {
    const result = canonicalCellText(makeRow(type), input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(expected);
  });

  const compositeCases: Array<[DataType, number, string, string]> = [
    ["hex", 2, "1234abcd", "1234 ABCD"],
    ["binary", 2, "1", "00000000 00000000 00000000 00000001"],
    ["unsigned", 2, "00065538", "65538"],
    ["unsigned-0.1", 2, "1.0", "1.0"],
    ["string", 2, "AB", "AB  "],
  ];
  it.each(compositeCases)(
    "范围行 %s×%i：%s → %s",
    (type, count, input, expected) => {
      const result = canonicalCellText(makeRowWithCount(type, count), input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(expected);
    },
  );

  it("解析失败返回结构化错误（调用方保留用户输入）", () => {
    const result = canonicalCellText(makeRow("unsigned"), "zz");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATA_INVALID_NUMBER");
  });

  it("插件类型经 resolver 格式化", () => {
    const resolver = createDataTypeResolver();
    resolver.register("my-plugin:speed", {
      parse: (text) =>
        ({ ok: true as const, value: Number(text) || 0 }) as const,
      format: (raw) => `${raw} rpm`,
    });
    const result = canonicalCellText(
      makeRow("my-plugin:speed" as DataType),
      "1500",
      resolver,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("1500 rpm");
  });
});
