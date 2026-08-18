/**
 * Data 单元格提交用例测试（TDD，docs/AGENTS.md §17/§23）。
 * 对称于 address.ts 的 commitAddress：校验失败返回结构化错误、保留输入（由调用方回写）；
 * 成功提交保留原文（不规范化，规范化是读取后的事，单一当前值模型 §15.1）。
 */
import { describe, expect, it } from "vitest";
import { createEmptyRow, type DataType } from "@mamep2026/domain";
import { commitCellText } from "./cell-text";

function makeRow(dataType: DataType) {
  return { ...createEmptyRow(), dataType, cellText: "" };
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

  it("成功提交保留用户原文（不做规范化，与读取后格式化覆盖解耦）", () => {
    const row = makeRow("hex");
    const result = commitCellText(row, " ab ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.cellText).toBe(" ab ");
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
});
