import { describe, expect, it } from "vitest";
import { defaultConfig } from "./config";
import {
  createEmptyRow,
  createEmptyWorkspace,
  createRegisterSheet,
  type RegisterRow,
} from "./workspace-model";

describe("createRegisterSheet 默认行（新建表默认填充 defaultRowCount 行）", () => {
  it("新建表默认生成 defaultRowCount 个空行", () => {
    const sheet = createRegisterSheet("S", 0);
    expect(sheet.rows).toHaveLength(
      defaultConfig.registerTable.defaultRowCount,
    );
  });

  it("默认行等价于 createEmptyRow()：关键字段为空、无默认地址/数值/名称", () => {
    const sheet = createRegisterSheet("S", 0);
    for (const row of sheet.rows) {
      const empty = createEmptyRow();
      expect(row.name).toBe("");
      expect(row.comment).toBe("");
      expect(row.addressDraft).toBe("");
      expect(row.addressValue).toBeNull();
      expect(row.cellText).toBe("");
      expect(row.lastKnownRawValue).toBeNull();
      expect(row.pollingEnabled).toBe(false);
      expect(row.traceEnabled).toBe(false);
      expect(row.dataType).toBe(empty.dataType);
    }
  });

  it("order 从 1 连续编号到 defaultRowCount（与 renumberRows 惯例一致）", () => {
    const sheet = createRegisterSheet("S", 0);
    const orders = sheet.rows.map((r) => r.order);
    const expected = Array.from(
      { length: defaultConfig.registerTable.defaultRowCount },
      (_, i) => i + 1,
    );
    expect(orders).toEqual(expected);
  });

  it("rowId 全部唯一", () => {
    const sheet = createRegisterSheet("S", 0);
    const ids = sheet.rows.map((r) => r.rowId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("columnWidths 初始为空（未拖拽过任何列，随表持久化）", () => {
    const sheet = createRegisterSheet("S", 0);
    expect(sheet.columnWidths).toEqual({});
  });

  it("columnOrder 初始为 null（未拖拽过任何列，使用默认顺序）", () => {
    const sheet = createRegisterSheet("S", 0);
    expect(sheet.columnOrder).toBeNull();
  });

  it("新建表默认处于打开状态（open=true，可从页签栏直接展示）", () => {
    const sheet = createRegisterSheet("S", 0);
    expect(sheet.open).toBe(true);
  });
});

describe("createEmptyWorkspace 初始表", () => {
  it("首启默认 Sheet 1 同样为 defaultRowCount 行", () => {
    const workspace = createEmptyWorkspace();
    expect(workspace.sheets).toHaveLength(1);
    expect(workspace.sheets[0]?.rows).toHaveLength(
      defaultConfig.registerTable.defaultRowCount,
    );
  });

  it("初始表行同样满足空行与连续 order 约束", () => {
    const workspace = createEmptyWorkspace();
    const sheet = workspace.sheets[0];
    if (sheet === undefined) throw new Error("missing sheet");
    const orders = sheet.rows.map((r) => r.order);
    const expected = Array.from(
      { length: defaultConfig.registerTable.defaultRowCount },
      (_, i) => i + 1,
    );
    expect(orders).toEqual(expected);
    for (const row of sheet.rows as RegisterRow[]) {
      expect(row.addressValue).toBeNull();
      expect(row.name).toBe("");
    }
  });
});
