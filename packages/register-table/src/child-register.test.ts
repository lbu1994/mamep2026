/**
 * 范围行子行编辑逻辑（child-register）单测。
 * 覆盖：commitChildCellText（子行自身 Type 解析/回写/父行 cellText 重算/基准派生）、
 * childDataType / ensureRegisters / resizeRegisters（范围变化保留策略）、setChildMeta。
 */
import { describe, expect, it } from "vitest";
import { createEmptyRow, newRowId, type RegisterRow } from "@mamep2026/domain";
import {
  childDataType,
  commitChildCellText,
  ensureRegisters,
  resizeRegisters,
  setChildMeta,
} from "./child-register";

function makeRow(overrides: Partial<RegisterRow> = {}): RegisterRow {
  const row = createEmptyRow();
  row.rowId = newRowId();
  return { ...row, ...overrides };
}

describe("childDataType", () => {
  it("优先子行独立 dataType", () => {
    const row = makeRow({
      registerCount: 2,
      dataType: "hex",
      registers: [
        { name: "", comment: "", dataType: "unsigned" },
        { name: "", comment: "", dataType: "signed" },
      ],
    });
    expect(childDataType(row, 0)).toBe("unsigned");
    expect(childDataType(row, 1)).toBe("signed");
  });

  it("registers 缺失时回退父行 dataType", () => {
    const row = makeRow({ registerCount: 2, dataType: "hex", registers: null });
    expect(childDataType(row, 1)).toBe("hex");
  });
});

describe("ensureRegisters", () => {
  it("范围行无 registers 时按父行 dataType 生成默认数组", () => {
    const row = makeRow({ registerCount: 3, dataType: "unsigned", registers: null });
    const regs = ensureRegisters(row);
    expect(regs).toHaveLength(3);
    expect(regs?.every((m) => m.dataType === "unsigned")).toBe(true);
    expect(regs?.every((m) => m.name === "" && m.comment === "")).toBe(true);
  });

  it("已有且长度匹配时原样返回", () => {
    const row = makeRow({
      registerCount: 2,
      registers: [
        { name: "a", comment: "", dataType: "hex" },
        { name: "b", comment: "", dataType: "hex" },
      ],
    });
    expect(ensureRegisters(row)).toBe(row.registers);
  });

  it("单寄存器行返回 null", () => {
    const row = makeRow({ registerCount: 1 });
    expect(ensureRegisters(row)).toBeNull();
  });
});

describe("resizeRegisters（范围变化保留策略）", () => {
  it("范围未变且已有 registers：原引用返回", () => {
    const row = makeRow({
      registerCount: 2,
      dataType: "hex",
      registers: [
        { name: "a", comment: "", dataType: "hex" },
        { name: "b", comment: "", dataType: "hex" },
      ],
    });
    expect(resizeRegisters(row, 2)).toBe(row.registers);
  });

  it("范围扩大：按索引保留并补默认（继承父行 dataType）", () => {
    const row = makeRow({
      registerCount: 2,
      dataType: "hex",
      registers: [
        { name: "a", comment: "c1", dataType: "unsigned" },
        { name: "b", comment: "", dataType: "hex" },
      ],
    });
    const next = resizeRegisters(row, 4);
    expect(next).toHaveLength(4);
    expect(next?.[0]).toEqual({ name: "a", comment: "c1", dataType: "unsigned" });
    expect(next?.[1]).toEqual({ name: "b", comment: "", dataType: "hex" });
    expect(next?.[2]).toEqual({ name: "", comment: "", dataType: "hex" });
    expect(next?.[3]).toEqual({ name: "", comment: "", dataType: "hex" });
  });

  it("范围缩小：按索引截断", () => {
    const row = makeRow({
      registerCount: 4,
      dataType: "hex",
      registers: [
        { name: "a", comment: "", dataType: "hex" },
        { name: "b", comment: "", dataType: "hex" },
        { name: "c", comment: "", dataType: "hex" },
        { name: "d", comment: "", dataType: "hex" },
      ],
    });
    const next = resizeRegisters(row, 2);
    expect(next).toHaveLength(2);
    expect(next?.[0]?.name).toBe("a");
    expect(next?.[1]?.name).toBe("b");
  });

  it("收窄为单寄存器：返回 null", () => {
    const row = makeRow({
      registerCount: 2,
      registers: [
        { name: "a", comment: "", dataType: "hex" },
        { name: "b", comment: "", dataType: "hex" },
      ],
    });
    expect(resizeRegisters(row, 1)).toBeNull();
  });
});

describe("commitChildCellText", () => {
  it("按子行自身 dataType 解析并回写 registerValues[i]、重算父行 cellText", () => {
    const row = makeRow({
      registerCount: 2,
      dataType: "hex",
      registerValues: [{ value: 0x1234 }, { value: 0xabcd }],
      cellText: "1234 ABCD",
      registers: [
        { name: "", comment: "", dataType: "unsigned" },
        { name: "", comment: "", dataType: "hex" },
      ],
    });
    const result = commitChildCellText(row, 0, "300");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registerValues?.map((v) => v.value)).toEqual([300, 0xabcd]);
    // 父行 cellText 按父行 dataType（hex）规范化。
    expect(result.value.cellText).toBe("012C ABCD");
  });

  it("registerValues 为 null 时由父行 cellText 派生基准再置位", () => {
    const row = makeRow({
      registerCount: 2,
      dataType: "hex",
      cellText: "12 34",
      registerValues: null,
      registers: null,
    });
    const result = commitChildCellText(row, 1, "ABCD");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registerValues?.map((v) => v.value)).toEqual([0x12, 0xabcd]);
    expect(result.value.cellText).toBe("0012 ABCD");
  });

  it("父行 cellText 无法派生时（空/非法）全 0 填充基准", () => {
    const row = makeRow({
      registerCount: 2,
      dataType: "hex",
      cellText: "",
      registerValues: null,
      registers: null,
    });
    const result = commitChildCellText(row, 1, "1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registerValues?.map((v) => v.value)).toEqual([0, 1]);
    expect(result.value.cellText).toBe("0000 0001");
  });

  it("非法文本按子行自身 Type 返回结构化校验错误", () => {
    const row = makeRow({
      registerCount: 2,
      dataType: "hex",
      registers: [
        { name: "", comment: "", dataType: "unsigned" },
        { name: "", comment: "", dataType: "hex" },
      ],
    });
    const result = commitChildCellText(row, 0, "zz");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DATA_INVALID_NUMBER");
  });

  it("单寄存器行走子行编辑返回错误", () => {
    const row = makeRow({ registerCount: 1 });
    const result = commitChildCellText(row, 0, "1");
    expect(result.ok).toBe(false);
  });

  it("index 越界返回错误", () => {
    const row = makeRow({ registerCount: 2 });
    const result = commitChildCellText(row, 5, "1");
    expect(result.ok).toBe(false);
  });
});

describe("setChildMeta", () => {
  it("更新子行 name/comment/dataType 且不动值", () => {
    const row = makeRow({
      registerCount: 2,
      dataType: "hex",
      registerValues: [{ value: 7 }, { value: 8 }],
      registers: null,
    });
    const result = setChildMeta(row, 0, { name: "T1", dataType: "unsigned" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registers?.[0]).toEqual({
      name: "T1",
      comment: "",
      dataType: "unsigned",
    });
    expect(result.value.registers?.[1]).toEqual({
      name: "",
      comment: "",
      dataType: "hex",
    });
    expect(result.value.registerValues?.map((v) => v.value)).toEqual([7, 8]);
  });

  it("无实际变化时原引用返回（零更新）", () => {
    const row = makeRow({
      registerCount: 2,
      registers: [
        { name: "a", comment: "", dataType: "hex" },
        { name: "", comment: "", dataType: "hex" },
      ],
    });
    const result = setChildMeta(row, 0, { name: "a" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(row);
  });

  it("单寄存器行 / index 越界返回错误", () => {
    const single = makeRow({ registerCount: 1 });
    expect(setChildMeta(single, 0, { name: "x" }).ok).toBe(false);
    const range = makeRow({ registerCount: 2 });
    expect(setChildMeta(range, 9, { name: "x" }).ok).toBe(false);
  });
});
