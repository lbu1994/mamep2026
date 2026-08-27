/**
 * tree-rows（ADR-030 范围行树形数据）单测。
 */
import { describe, expect, it } from "vitest";
import { createEmptyRow, newRowId, type RegisterRow } from "@mamep2026/domain";
import { buildTreeRows, isVirtualChildRow } from "./tree-rows";

function makeRow(overrides: Partial<RegisterRow> = {}): RegisterRow {
  const row = createEmptyRow();
  row.rowId = newRowId();
  return { ...row, ...overrides };
}

describe("buildTreeRows", () => {
  it("passes single-register rows through unchanged", () => {
    const row = makeRow({ registerCount: 1 });
    const tree = buildTreeRows([row]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toBe(row);
  });

  it("creates one virtual child per register for range rows", () => {
    const row = makeRow({ registerCount: 3 });
    const tree = buildTreeRows([row]);
    const parent = tree[0];
    expect(parent).toBeDefined();
    const children = (parent as { children?: unknown[] }).children;
    expect(children).toHaveLength(3);
    expect(isVirtualChildRow(children?.[0] as RegisterRow)).toBe(true);
    expect(isVirtualChildRow(children?.[2] as RegisterRow)).toBe(true);
  });

  it("assigns sequential addresses and data text to children", () => {
    const row = makeRow({
      registerCount: 2,
      registerValues: [{ value: 0x1234 }, { value: 0xabcd }],
    });
    // addressValue 未提交时 base=0
    const tree = buildTreeRows([row]);
    const children = (tree[0] as { children?: Array<{ __virtualChild: { index: number; address: number; dataText: string | null }; cellText: string }> }).children ?? [];
    expect(children[0]?.__virtualChild.address).toBe(0);
    expect(children[1]?.__virtualChild.address).toBe(1);
    expect(children[0]?.__virtualChild.dataText).toBe("1234");
    expect(children[1]?.__virtualChild.dataText).toBe("ABCD");
  });

  it("formats data text by the parent data type", () => {
    const row = makeRow({
      registerCount: 2,
      registerValues: [{ value: 0xffff }],
      dataType: "signed",
    });
    const tree = buildTreeRows([row]);
    const children = (tree[0] as { children?: Array<{ __virtualChild: { dataText: string | null } }> }).children ?? [];
    expect(children[0]?.__virtualChild.dataText).toBe("-1");
  });

  it("carries per-register name/comment/dataType from parent registers meta", () => {
    const row = makeRow({
      registerCount: 2,
      dataType: "hex",
      registers: [
        { name: "Hi", comment: "high", dataType: "unsigned" },
        { name: "Lo", comment: "low", dataType: "signed-0.1" },
      ],
    });
    const tree = buildTreeRows([row]);
    const children = (tree[0] as { children?: Array<RegisterRow> }).children ?? [];
    expect(children[0]?.name).toBe("Hi");
    expect(children[0]?.comment).toBe("high");
    expect(children[0]?.dataType).toBe("unsigned");
    expect(children[1]?.name).toBe("Lo");
    expect(children[1]?.dataType).toBe("signed-0.1");
  });

  it("formats each child value by its own dataType", () => {
    const row = makeRow({
      registerCount: 2,
      registerValues: [{ value: 0xffff }, { value: 0x1234 }],
      dataType: "hex",
      registers: [
        { name: "", comment: "", dataType: "signed" },
        { name: "", comment: "", dataType: "unsigned" },
      ],
    });
    const tree = buildTreeRows([row]);
    const children = (tree[0] as { children?: Array<{ cellText: string }> }).children ?? [];
    expect(children[0]?.cellText).toBe("-1");
    expect(children[1]?.cellText).toBe("4660");
  });

  it("falls back to parent dataType when registers meta is missing", () => {
    const row = makeRow({
      registerCount: 2,
      registerValues: [{ value: 0xffff }],
      dataType: "signed",
      registers: null,
    });
    const tree = buildTreeRows([row]);
    const children = (tree[0] as { children?: Array<RegisterRow> }).children ?? [];
    expect(children[0]?.dataType).toBe("signed");
    expect(children[0]?.name).toBe("");
  });

  it("uses null data text when a register has not been read", () => {
    const row = makeRow({ registerCount: 2, registerValues: null });
    const tree = buildTreeRows([row]);
    const children = (tree[0] as { children?: Array<{ __virtualChild: { dataText: string | null } }> }).children ?? [];
    expect(children[0]?.__virtualChild.dataText).toBeNull();
    expect(children[1]?.__virtualChild.dataText).toBeNull();
  });

  it("keeps single-register rows with values as non-children", () => {
    const row = makeRow({ registerCount: 1, registerValues: [{ value: 7 }] });
    const tree = buildTreeRows([row]);
    expect(isVirtualChildRow(tree[0] as RegisterRow)).toBe(false);
  });
});
