/**
 * 位明细领域逻辑（bit-register）单测。
 * 覆盖：bitMaskText、readRegisterBit/readBitComment、buildBitEntries（顺序 bit15→bit0）、
 * setRegisterBit（单行/范围行、值回写、父行 cellText 重算、未读值基准派生、无变化原引用返回、越界错误）、
 * setBitComment（写入/清除/全空归一、无变化原引用返回）、resizeBitComments（保留/截断/补齐）。
 */
import { describe, expect, it } from "vitest";
import { createEmptyRow, newRowId, type RegisterRow } from "@mamep2026/domain";
import { commitCellText } from "./cell-text";
import {
  BITS_PER_REGISTER,
  bitMaskText,
  buildBitEntries,
  readBitComment,
  readBitName,
  readRegisterBit,
  resizeBitComments,
  resizeBitNames,
  setBitComment,
  setBitName,
  setRegisterBit,
} from "./bit-register";

function makeRow(overrides: Partial<RegisterRow> = {}): RegisterRow {
  const row = createEmptyRow();
  row.rowId = newRowId();
  return { ...row, ...overrides };
}

describe("bitMaskText", () => {
  it("按 bit 号给出 4 位大写 HEX 掩码", () => {
    expect(bitMaskText(0)).toBe("0x0001");
    expect(bitMaskText(3)).toBe("0x0008");
    expect(bitMaskText(15)).toBe("0x8000");
  });
});

describe("readRegisterBit / readBitComment", () => {
  it("未读取（registerValues=null）时位值为 null", () => {
    const row = makeRow({ registerValues: null });
    expect(readRegisterBit(row, 0, 0)).toBeNull();
    expect(readRegisterBit(row, 0, 15)).toBeNull();
  });

  it("按 bit 号取位（bit0 低位、bit15 高位）", () => {
    const row = makeRow({ registerValues: [{ value: 0x8001 }] });
    expect(readRegisterBit(row, 0, 0)).toBe(1);
    expect(readRegisterBit(row, 0, 1)).toBe(0);
    expect(readRegisterBit(row, 0, 15)).toBe(1);
    expect(readRegisterBit(row, 0, 14)).toBe(0);
  });

  it("范围行按下标读取对应寄存器", () => {
    const row = makeRow({
      registerCount: 2,
      registerValues: [{ value: 0x0000 }, { value: 0xffff }],
    });
    expect(readRegisterBit(row, 0, 0)).toBe(0);
    expect(readRegisterBit(row, 1, 0)).toBe(1);
  });

  it("越界返回 null（不抛异常）", () => {
    const row = makeRow({ registerValues: [{ value: 0x0001 }] });
    expect(readRegisterBit(row, 1, 0)).toBeNull();
    expect(readRegisterBit(row, 0, BITS_PER_REGISTER)).toBeNull();
    expect(readRegisterBit(row, 0, -1)).toBeNull();
  });

  it("位注释缺省为空串", () => {
    const row = makeRow();
    expect(readBitComment(row, 0, 0)).toBe("");
  });

  it("位名称缺省为空串", () => {
    const row = makeRow();
    expect(readBitName(row, 0, 0)).toBe("");
  });
});

describe("buildBitEntries", () => {
  it("按 bit15 → bit0 顺序返回位号/掩码/值/名称/注释", () => {
    const row = makeRow({
      dataType: "binary",
      registerValues: [{ value: 0x8001 }],
      bitComments: [["carry", ...Array.from({ length: 15 }, () => "")]],
      // 内层下标 = bit 号：index 0 即 bit0 的名称（显示序 bit15 在上）。
      bitNames: [["bit0 name", ...Array.from({ length: 15 }, () => "")]],
    });
    const entries = buildBitEntries(row, 0);
    expect(entries).toHaveLength(BITS_PER_REGISTER);
    expect(entries[0]).toEqual({
      bit: 15,
      value: 1,
      maskText: "0x8000",
      name: "",
      comment: "",
    });
    expect(entries[15]).toEqual({
      bit: 0,
      value: 1,
      maskText: "0x0001",
      name: "bit0 name",
      comment: "carry",
    });
  });
});

describe("setRegisterBit", () => {
  it("单寄存器行置位：回写 registerValues 并按 binary 重算父行 cellText", () => {
    const row = makeRow({
      dataType: "binary",
      registerValues: [{ value: 0x0000 }],
      cellText: "00000000 00000000",
    });
    const result = setRegisterBit(row, 0, 3, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registerValues?.[0]?.value).toBe(0x0008);
    expect(result.value.cellText).toBe("00000000 00001000");
  });

  it("单寄存器行清位：按 hex 规范化显示", () => {
    const row = makeRow({
      dataType: "hex",
      registerValues: [{ value: 0xffff }],
    });
    const result = setRegisterBit(row, 0, 15, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registerValues?.[0]?.value).toBe(0x7fff);
    expect(result.value.cellText).toBe("7FFF");
  });

  it("范围行：只改目标寄存器并重算组合文本", () => {
    const row = makeRow({
      registerCount: 2,
      dataType: "hex",
      registerValues: [{ value: 0x1234 }, { value: 0x0000 }],
      cellText: "1234 0000",
    });
    const result = setRegisterBit(row, 1, 0, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registerValues?.map((v) => v.value)).toEqual([
      0x1234, 0x0001,
    ]);
    expect(result.value.cellText).toBe("1234 0001");
  });

  it("未读取值时按 cellText 派生基准（二进制组合文本）", () => {
    const row = makeRow({
      dataType: "binary",
      registerValues: null,
      cellText: "00000000 00000001",
    });
    const result = setRegisterBit(row, 0, 0, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registerValues?.[0]?.value).toBe(0);
    expect(result.value.cellText).toBe("00000000 00000000");
  });

  it("cellText 无法派生时以全 0 为基准", () => {
    const row = makeRow({ dataType: "binary", registerValues: null });
    const result = setRegisterBit(row, 0, 15, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registerValues?.[0]?.value).toBe(0x8000);
    expect(result.value.cellText).toBe("10000000 00000000");
  });

  it("位值未变化且已有当前值时原引用返回（零更新）", () => {
    const row = makeRow({
      dataType: "binary",
      registerValues: [{ value: 0x0008 }],
    });
    const result = setRegisterBit(row, 0, 3, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(row);
  });

  it("寄存器序号越界返回结构化错误", () => {
    const row = makeRow({ registerValues: [{ value: 0 }] });
    const result = setRegisterBit(row, 1, 0, 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BIT_REGISTER_INDEX_OUT_OF_RANGE");
  });

  it("bit 号越界返回结构化错误", () => {
    const row = makeRow({ registerValues: [{ value: 0 }] });
    const result = setRegisterBit(row, 0, 16, 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BIT_INDEX_OUT_OF_RANGE");
  });

  it("父行手工编辑后位切换以编辑后的值为基准（不覆盖用户输入，2026-09-11 bug 修复）", () => {
    const row = makeRow({
      registerCount: 2,
      dataType: "hex",
      cellText: "1234 ABCD",
      registerValues: [{ value: 0x1234 }, { value: 0xabcd }],
    });
    const committed = commitCellText(row, "FFFF 0000");
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    // 清 bit0：0xFFFF → 0xFFFE（基准须为编辑后的 FFFF，而非旧读值 1234）。
    const toggled = setRegisterBit(committed.value, 0, 0, 0);
    expect(toggled.ok).toBe(true);
    if (!toggled.ok) return;
    expect(toggled.value.cellText).toBe("FFFE 0000");
  });
});

describe("setBitComment", () => {
  it("写入位注释（单寄存器行）", () => {
    const row = makeRow({ dataType: "binary" });
    const result = setBitComment(row, 0, 15, "alarm");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBitComment(result.value, 0, 15)).toBe("alarm");
    // 内层长度固定 16。
    expect(result.value.bitComments?.[0]).toHaveLength(BITS_PER_REGISTER);
    expect(result.value.bitComments?.[0]?.[0]).toBe("");
  });

  it("清除注释：该寄存器全空时归一为 null", () => {
    const row = makeRow({ dataType: "binary" });
    const withComment = setBitComment(row, 0, 3, "flag");
    expect(withComment.ok).toBe(true);
    if (!withComment.ok) return;
    const cleared = setBitComment(withComment.value, 0, 3, "");
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.value.bitComments).toBeNull();
  });

  it("范围行按寄存器序号分别存储（其他寄存器保留）", () => {
    const row = makeRow({ registerCount: 2, dataType: "binary" });
    const first = setBitComment(row, 0, 1, "a");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = setBitComment(first.value, 1, 2, "b");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.bitComments?.[0]?.[1]).toBe("a");
    expect(second.value.bitComments?.[1]?.[2]).toBe("b");
  });

  it("注释未变化时原引用返回（不产生撤销条目）", () => {
    const row = makeRow({ dataType: "binary", bitComments: [["x"]] });
    const result = setBitComment(row, 0, 0, "x");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(row);
  });

  it("越界返回结构化错误", () => {
    const row = makeRow({ dataType: "binary" });
    const result = setBitComment(row, 0, 99, "x");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BIT_INDEX_OUT_OF_RANGE");
  });
});

describe("setBitName", () => {
  it("写入位名称（单寄存器行）", () => {
    const row = makeRow({ dataType: "binary" });
    const result = setBitName(row, 0, 15, "alarm");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBitName(result.value, 0, 15)).toBe("alarm");
    expect(result.value.bitNames?.[0]).toHaveLength(BITS_PER_REGISTER);
    expect(result.value.bitNames?.[0]?.[0]).toBe("");
    // 与注释互不影响。
    expect(result.value.bitComments).toBeNull();
  });

  it("清除名称：该寄存器全空时归一为 null", () => {
    const row = makeRow({ dataType: "binary" });
    const withName = setBitName(row, 0, 3, "flag");
    expect(withName.ok).toBe(true);
    if (!withName.ok) return;
    const cleared = setBitName(withName.value, 0, 3, "");
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.value.bitNames).toBeNull();
  });

  it("范围行按寄存器序号分别存储", () => {
    const row = makeRow({ registerCount: 2, dataType: "binary" });
    const first = setBitName(row, 0, 1, "a");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = setBitName(first.value, 1, 2, "b");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.bitNames?.[0]?.[1]).toBe("a");
    expect(second.value.bitNames?.[1]?.[2]).toBe("b");
  });

  it("名称未变化时原引用返回（不产生撤销条目）", () => {
    const row = makeRow({ dataType: "binary", bitNames: [["x"]] });
    const result = setBitName(row, 0, 0, "x");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(row);
  });

  it("越界返回结构化错误", () => {
    const row = makeRow({ dataType: "binary" });
    const result = setBitName(row, 0, 99, "x");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BIT_INDEX_OUT_OF_RANGE");
  });
});

describe("resizeBitComments", () => {
  it("null 输入返回 null", () => {
    expect(resizeBitComments(null, 2)).toBeNull();
  });

  it("范围收缩时按寄存器序号截断", () => {
    const slots = (label: string) =>
      Array.from({ length: BITS_PER_REGISTER }, (_, index) =>
        index === 0 ? label : "",
      );
    const result = resizeBitComments([slots("a"), slots("b")], 1);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.[0]).toBe("a");
  });

  it("范围扩展时以 null 补齐", () => {
    const result = resizeBitComments([["a"]], 3);
    expect(result).toHaveLength(3);
    expect(result?.[0]?.[0]).toBe("a");
    expect(result?.[1]).toBeNull();
    expect(result?.[2]).toBeNull();
  });

  it("补齐后仍全空则归一为 null", () => {
    expect(resizeBitComments([null], 2)).toBeNull();
  });
});

describe("resizeBitNames", () => {
  it("null 输入返回 null", () => {
    expect(resizeBitNames(null, 2)).toBeNull();
  });

  it("范围收缩时按寄存器序号截断", () => {
    const slots = (label: string) =>
      Array.from({ length: BITS_PER_REGISTER }, (_, index) =>
        index === 0 ? label : "",
      );
    const result = resizeBitNames([slots("a"), slots("b")], 1);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.[0]).toBe("a");
  });

  it("范围扩展时以 null 补齐", () => {
    const result = resizeBitNames([["a"]], 3);
    expect(result).toHaveLength(3);
    expect(result?.[0]?.[0]).toBe("a");
    expect(result?.[1]).toBeNull();
  });
});
