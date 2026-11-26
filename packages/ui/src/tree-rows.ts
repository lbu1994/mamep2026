/**
 * 范围行 / 位明细树形数据构造（+ 子行可编辑化 + 位明细）：
 * - registerCount>1 的父行展开为 antd Table tree 数据（children=每寄存器一子行）；
 * - 单寄存器行 / 范围行寄存器子行若为 binary 类型，再展开为 16 行位明细
 *   （顺序 bit15 → bit0，MSB first）；
 * - 子行为派生的虚拟行（不持久化、不进 store），携带自身独立元数据
 *   （name/comment/dataType，来自父行 registers[i]）与按自身 Type 格式化的值；
 * - 子行编辑经 app-store 的 commitChildCellText / setChildMeta 路由回父行；
 *   位行编辑/注释经 app-store 的 setRegisterBit / setBitComment 路由回所属寄存器行；
 * - 纯函数，便于 jsdom 单测。
 */
import type { RegisterRow, RowId, Result } from "@mamep2026/domain";
import {
  singleRegisterDataType,
  validateRowExpansion,
  ok,
} from "@mamep2026/domain";
import { formatRawValue } from "@mamep2026/data-conversion";
import { BITS_PER_REGISTER, buildBitEntries } from "@mamep2026/register-table";

/** 虚拟子行的只读展示字段。 */
export interface VirtualChildInfo {
  /** 子行在父行内的序号（0-based）。 */
  index: number;
  parentRowId: RowId;
  /** 该寄存器所属真实父行的界面行号；可编辑单元格名称使用。 */
  parentOrder: number;
  /** 该寄存器实际地址 = 父行起始地址 + index。 */
  address: number;
  /** 该寄存器原始值格式化文本（未读取时为 null）。 */
  dataText: string | null;
}

/** 虚拟子行：领域 RegisterRow 的超集（仅前端展示用，不落 store/持久化）。 */
export type VirtualChildRow = RegisterRow & {
  __virtualChild: VirtualChildInfo;
};

/** 位明细虚拟行信息。 */
export interface VirtualBitInfo {
  /** bit 号（0..15）。 */
  bit: number;
  /** 该位所属寄存器在父行内的序号（单寄存器行恒为 0）。 */
  registerIndex: number;
  /** 虚拟寄存器行 id（单寄存器行=父行自身；范围行=`<rowId>:c<i>`）：仅供派生行 key，**不入 store**。 */
  registerRowId: RowId;
  /** 该寄存器的主行 rowId（**store 中的真实行 id**）：位值/位注释编辑一律经它 + registerIndex 路由。 */
  parentRowId: RowId;
  /** 该寄存器所属真实父行的界面行号；位开关可访问名称使用。 */
  parentOrder: number;
  /** 位掩码文本（如 `0x8000`）。 */
  maskText: string;
  /** 该位所在寄存器的实际地址（父行起始地址 + registerIndex）；Address 列展示用。 */
  address: number;
  /** 该位当前值；null=该寄存器尚未读取。 */
  value: 0 | 1 | null;
}

/** 位明细虚拟行：领域 RegisterRow 的超集（仅前端展示用，不落 store/持久化）。 */
export type VirtualBitRow = RegisterRow & {
  __virtualBit: VirtualBitInfo;
};

/** 表格数据行：普通行、带 children 的父行、范围行子行或位明细行。 */
export type TreeRow = RegisterRow | VirtualChildRow | VirtualBitRow;

/** 判断是否为虚拟子行（范围行寄存器子行；各 cell 据此渲染只读/可编辑分支）。 */
export function isVirtualChildRow(
  row: RegisterRow | null | undefined,
): row is VirtualChildRow {
  return (
    row !== null &&
    row !== undefined &&
    (row as Partial<VirtualChildRow>).__virtualChild !== undefined
  );
}

/** 判断是否为位明细行。 */
export function isVirtualBitRow(
  row: RegisterRow | null | undefined,
): row is VirtualBitRow {
  return (
    row !== null &&
    row !== undefined &&
    (row as Partial<VirtualBitRow>).__virtualBit !== undefined
  );
}

/** 判断是否为任一派生虚拟行（范围行子行或位明细行）：不可拖拽/多选/右键，走普通 `<tr>`。 */
export function isVirtualRow(
  row: RegisterRow | null | undefined,
): row is VirtualChildRow | VirtualBitRow {
  return isVirtualChildRow(row) || isVirtualBitRow(row);
}

/** 该类型是否支持位明细展开（仅内置 binary）。 */
export function supportsBitDetail(dataType: string): boolean {
  return dataType === "binary";
}

/**
 * 构造某寄存器的 16 行位明细（顺序 bit15 → bit0）。
 * `registerRowId`：该寄存器所在的「寄存器行」rowId（单寄存器行=父行自身；范围行=寄存器子行）。
 */
function buildBitRows(
  row: RegisterRow,
  registerIndex: number,
  registerRowId: RowId,
): VirtualBitRow[] {
  const baseAddress = row.addressValue?.value ?? 0;
  return buildBitEntries(row, registerIndex).map((entry) => ({
    ...row,
    // 位行 key：寄存器行 id + bit 号（不参与拖拽/多选，仅作 antd rowKey）。
    rowId: `${registerRowId}:b${entry.bit}` as RowId,
    order: 0,
    registerCount: 1,
    // 位名称：Name 列可编辑（同 Comment 列语义）。
    name: entry.name,
    comment: entry.comment,
    dataType: "binary",
    cellText: entry.value === null ? "" : String(entry.value),
    registerValues: entry.value === null ? null : [{ value: entry.value }],
    registers: null,
    bitComments: null,
    bitNames: null,
    __virtualBit: {
      bit: entry.bit,
      registerIndex,
      registerRowId,
      parentRowId: row.rowId,
      parentOrder: row.order,
      maskText: entry.maskText,
      address: baseAddress + registerIndex,
      value: entry.value,
    },
  }));
}

/** Build register and bit children, or return a structured error before allocation. */
export function buildTreeRows(rows: readonly RegisterRow[]): Result<TreeRow[]> {
  // Validate the whole input before allocating any register or bit children.
  const expansion = validateRowExpansion(rows);
  if (!expansion.ok) return expansion;
  const treeRows = rows.map((row) => {
    // 单寄存器行：binary 时展开位明细。
    if (row.registerCount <= 1) {
      if (!supportsBitDetail(row.dataType)) return row;
      return {
        ...row,
        children: buildBitRows(row, 0, row.rowId),
      } as TreeRow;
    }
    const baseAddress = row.addressValue?.value ?? 0;
    const children: VirtualChildRow[] = [];
    for (let i = 0; i < row.registerCount; i += 1) {
      const raw = row.registerValues?.[i]?.value;
      // 子行独立元数据：优先父行 registers[i]，缺省回退父行 dataType/空串。
      const meta = row.registers?.[i];
      const childType = singleRegisterDataType(meta?.dataType ?? row.dataType);
      const dataText =
        raw !== null && raw !== undefined
          ? formatRawValue(raw, childType)
          : null;
      const childRowId = `${row.rowId}:c${i}` as RowId;
      children.push({
        ...row,
        // 子行 key：父 rowId + 序号（与 SortableContext 父行 id 区分，不可拖拽/多选）。
        rowId: childRowId,
        order: 0,
        registerCount: 1,
        // 子行自身元数据：Name/Comment/Type 列展示与编辑用（改经父行 registers 落盘）。
        name: meta?.name ?? "",
        comment: meta?.comment ?? "",
        dataType: childType,
        cellText: dataText ?? "",
        registerValues:
          raw !== null && raw !== undefined ? [{ value: raw }] : null,
        __virtualChild: {
          index: i,
          parentRowId: row.rowId,
          parentOrder: row.order,
          address: baseAddress + i,
          dataText,
        },
        // 该寄存器自身为 binary 时可再展开位明细。
        ...(supportsBitDetail(childType)
          ? { children: buildBitRows(row, i, childRowId) }
          : {}),
      } as VirtualChildRow);
    }
    return { ...row, children } as TreeRow;
  });
  return ok(treeRows);
}

/** 位明细行数（每寄存器 16 位）；供 UI/测试引用。 */
export { BITS_PER_REGISTER };
