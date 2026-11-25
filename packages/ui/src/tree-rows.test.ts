/**
 * tree-rows（范围行树形数据）单测。
 */
import { describe, expect, it } from "vitest";
import { createEmptyRow, newRowId, type RegisterRow } from "@mamep2026/domain";
import { BITS_PER_REGISTER } from "@mamep2026/register-table";
import { buildTreeRows, isVirtualBitRow, isVirtualChildRow } from "./tree-rows";

function makeRow(overrides: Partial<RegisterRow> = {}): RegisterRow {
  const row = createEmptyRow();
  row.rowId = newRowId();
  return { ...row, ...overrides };
}

describe("buildTreeRows", () => {
  it("shows float range children as individual HEX words", () => {
    const row = makeRow({ registerCount: 2, dataType: "float32", registerValues: [{ value: 0x3f80 }, { value: 0 }] });
    const parent = buildTreeRows([row])[0];
    if (parent === undefined || !("children" in parent) || !Array.isArray(parent.children)) throw new Error("missing children");
    expect(parent.children.map((child: RegisterRow) => [child.dataType, child.cellText])).toEqual([["hex", "3F80"], ["hex", "0000"]]);
  });
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
    const children =
      (
        tree[0] as {
          children?: Array<{
            __virtualChild: {
              index: number;
              address: number;
              parentOrder: number;
              dataText: string | null;
            };
            cellText: string;
          }>;
        }
      ).children ?? [];
    expect(children[0]?.__virtualChild.address).toBe(0);
    expect(children[1]?.__virtualChild.address).toBe(1);
    expect(children[0]?.__virtualChild.parentOrder).toBe(row.order);
    expect(children[1]?.__virtualChild.parentOrder).toBe(row.order);
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
    const children =
      (
        tree[0] as {
          children?: Array<{ __virtualChild: { dataText: string | null } }>;
        }
      ).children ?? [];
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
    const children =
      (tree[0] as { children?: Array<RegisterRow> }).children ?? [];
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
    const children =
      (tree[0] as { children?: Array<{ cellText: string }> }).children ?? [];
    expect(children[0]?.cellText).toBe("-1");
    expect(children[1]?.cellText).toBe("4660");
  });

  it("formats a binary child value grouped every 8 bits（ADR-051）", () => {
    const row = makeRow({
      registerCount: 2,
      registerValues: [{ value: 0x1111 }, { value: 0x00f0 }],
      dataType: "binary",
      registers: null,
    });
    const tree = buildTreeRows([row]);
    const children =
      (tree[0] as { children?: Array<{ cellText: string }> }).children ?? [];
    expect(children[0]?.cellText).toBe("00010001 00010001");
    expect(children[1]?.cellText).toBe("00000000 11110000");
  });

  it("falls back to parent dataType when registers meta is missing", () => {
    const row = makeRow({
      registerCount: 2,
      registerValues: [{ value: 0xffff }],
      dataType: "signed",
      registers: null,
    });
    const tree = buildTreeRows([row]);
    const children =
      (tree[0] as { children?: Array<RegisterRow> }).children ?? [];
    expect(children[0]?.dataType).toBe("signed");
    expect(children[0]?.name).toBe("");
  });

  it("uses null data text when a register has not been read", () => {
    const row = makeRow({ registerCount: 2, registerValues: null });
    const tree = buildTreeRows([row]);
    const children =
      (
        tree[0] as {
          children?: Array<{ __virtualChild: { dataText: string | null } }>;
        }
      ).children ?? [];
    expect(children[0]?.__virtualChild.dataText).toBeNull();
    expect(children[1]?.__virtualChild.dataText).toBeNull();
  });

  it("keeps single-register rows with values as non-children", () => {
    const row = makeRow({ registerCount: 1, registerValues: [{ value: 7 }] });
    const tree = buildTreeRows([row]);
    expect(isVirtualChildRow(tree[0] as RegisterRow)).toBe(false);
  });
});

describe("buildTreeRows 位明细（ADR-052）", () => {
  it("单寄存器 binary 行展开为 16 行位明细（bit15 → bit0）", () => {
    const row = makeRow({
      registerCount: 1,
      dataType: "binary",
      registerValues: [{ value: 0x8001 }],
    });
    const tree = buildTreeRows([row]);
    const children =
      (tree[0] as { children?: Array<RegisterRow> }).children ?? [];
    expect(children).toHaveLength(BITS_PER_REGISTER);
    expect(children.every((child) => isVirtualBitRow(child))).toBe(true);
    const first = children[0] as unknown as {
      __virtualBit: { bit: number; maskText: string; value: 0 | 1 | null };
    };
    const last = children[15] as unknown as {
      __virtualBit: { bit: number; maskText: string; value: 0 | 1 | null };
    };
    expect(first.__virtualBit.bit).toBe(15);
    expect(first.__virtualBit.maskText).toBe("0x8000");
    expect(first.__virtualBit.value).toBe(1);
    expect(last.__virtualBit.bit).toBe(0);
    expect(last.__virtualBit.maskText).toBe("0x0001");
    expect(last.__virtualBit.value).toBe(1);
  });

  it("非 binary 单寄存器行不生成位明细", () => {
    const row = makeRow({ registerCount: 1, dataType: "hex" });
    const tree = buildTreeRows([row]);
    expect((tree[0] as { children?: unknown[] }).children).toBeUndefined();
    expect(isVirtualBitRow(tree[0] as RegisterRow)).toBe(false);
  });

  it("位明细行携带位号/掩码/名称/注释与寄存器路由信息", () => {
    const row = makeRow({
      registerCount: 1,
      dataType: "binary",
      addressValue: { value: 0x2000 } as never,
      registerValues: [{ value: 0x0004 }],
      bitComments: [
        Array.from({ length: 16 }, (_, index) => (index === 2 ? "ready" : "")),
      ],
      bitNames: [
        Array.from({ length: 16 }, (_, index) =>
          index === 2 ? "Ready flag" : "",
        ),
      ],
    });
    const tree = buildTreeRows([row]);
    const children =
      (tree[0] as { children?: Array<RegisterRow> }).children ?? [];
    const bit2 = children.find(
      (child) =>
        (child as unknown as { __virtualBit: { bit: number } }).__virtualBit
          .bit === 2,
    );
    expect(bit2).toBeDefined();
    const info = (
      bit2 as unknown as {
        __virtualBit: {
          registerIndex: number;
          registerRowId: string;
          parentRowId: string;
          address: number;
          maskText: string;
          value: 0 | 1 | null;
        };
        comment: string;
        cellText: string;
      }
    ).__virtualBit;
    expect(info.registerIndex).toBe(0);
    expect(info.registerRowId).toBe(row.rowId);
    expect(info.parentRowId).toBe(row.rowId);
    expect(info.address).toBe(0x2000);
    expect(info.maskText).toBe("0x0004");
    expect(info.value).toBe(1);
    // 位名称/注释直接映射到 RegisterRow.name/comment（Name/Comment 列可编辑）。
    expect((bit2 as RegisterRow).name).toBe("Ready flag");
    expect((bit2 as RegisterRow).comment).toBe("ready");
    expect((bit2 as RegisterRow).cellText).toBe("1");
  });

  it("范围行寄存器子行为 binary 时可再展开位明细（两层嵌套）", () => {
    const row = makeRow({
      registerCount: 2,
      dataType: "binary",
      registerValues: [{ value: 0x0000 }, { value: 0xffff }],
    });
    const tree = buildTreeRows([row]);
    const children =
      (tree[0] as { children?: Array<RegisterRow> }).children ?? [];
    expect(children).toHaveLength(2);
    const secondChildren = (
      children[1] as unknown as { children?: Array<RegisterRow> }
    ).children;
    expect(secondChildren).toHaveLength(BITS_PER_REGISTER);
    expect(isVirtualBitRow(secondChildren?.[0] as RegisterRow)).toBe(true);
    const info = (
      secondChildren?.[0] as unknown as {
        __virtualBit: {
          bit: number;
          registerIndex: number;
          parentRowId: string;
          value: 0 | 1 | null;
        };
      }
    ).__virtualBit;
    expect(info.bit).toBe(15);
    expect(info.registerIndex).toBe(1);
    expect(info.parentRowId).toBe(row.rowId);
    expect(info.value).toBe(1);
  });

  it("范围行子行非 binary 时不生成位明细", () => {
    const row = makeRow({
      registerCount: 2,
      dataType: "hex",
      registers: [
        { name: "", comment: "", dataType: "hex" },
        { name: "", comment: "", dataType: "binary" },
      ],
    });
    const tree = buildTreeRows([row]);
    const children =
      (tree[0] as { children?: Array<RegisterRow> }).children ?? [];
    expect(
      (children[0] as unknown as { children?: unknown[] }).children,
    ).toBeUndefined();
    expect(
      (children[1] as unknown as { children?: unknown[] }).children,
    ).toHaveLength(BITS_PER_REGISTER);
  });

  it("未读取时位值为 null 且 Data 文本为空（显示占位）", () => {
    const row = makeRow({
      registerCount: 1,
      dataType: "binary",
      registerValues: null,
    });
    const tree = buildTreeRows([row]);
    const children =
      (tree[0] as { children?: Array<RegisterRow> }).children ?? [];
    expect(
      (children[0] as unknown as { __virtualBit: { value: unknown } })
        .__virtualBit.value,
    ).toBeNull();
    expect(children[0]?.cellText).toBe("");
  });
});
