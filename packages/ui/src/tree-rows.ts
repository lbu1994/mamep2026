/**
 * 范围行树形数据构造（ADR-030 + 2026-08-27 子行可编辑化）：
 * - registerCount>1 的父行展开为 antd Table tree 数据（children=每寄存器一子行）；
 * - 子行为派生的虚拟行（不持久化、不进 store），携带自身独立元数据
 *   （name/comment/dataType，来自父行 registers[i]）与按自身 Type 格式化的值；
 * - 子行编辑经 app-store 的 commitChildCellText / setChildMeta 路由回父行；
 * - 纯函数，便于 jsdom 单测。
 */
import type { RegisterRow, RowId } from "@mamep2026/domain";
import { formatRawValue } from "@mamep2026/data-conversion";

/** 虚拟子行的只读展示字段。 */
export interface VirtualChildInfo {
  /** 子行在父行内的序号（0-based）。 */
  index: number;
  parentRowId: RowId;
  /** 该寄存器实际地址 = 父行起始地址 + index。 */
  address: number;
  /** 该寄存器原始值格式化文本（未读取时为 null）。 */
  dataText: string | null;
}

/** 虚拟子行：领域 RegisterRow 的超集（仅前端展示用，不落 store/持久化）。 */
export type VirtualChildRow = RegisterRow & {
  __virtualChild: VirtualChildInfo;
};

/** 表格数据行：普通行或带 children 的父行。 */
export type TreeRow = RegisterRow | VirtualChildRow;

/** 判断是否为虚拟子行（各 cell 据此渲染只读/可编辑分支）。 */
export function isVirtualChildRow(
  row: RegisterRow | null | undefined,
): row is VirtualChildRow {
  return (
    row !== null &&
    row !== undefined &&
    (row as Partial<VirtualChildRow>).__virtualChild !== undefined
  );
}

/** 从表内行列表构造树形数据（children 仅在 registerCount>1 时生成）。 */
export function buildTreeRows(rows: readonly RegisterRow[]): TreeRow[] {
  return rows.map((row) => {
    if (row.registerCount <= 1) return row;
    const baseAddress = row.addressValue?.value ?? 0;
    const children: VirtualChildRow[] = [];
    for (let i = 0; i < row.registerCount; i += 1) {
      const raw = row.registerValues?.[i]?.value;
      // 子行独立元数据（2026-08-27）：优先父行 registers[i]，缺省回退父行 dataType/空串。
      const meta = row.registers?.[i];
      const childType = meta?.dataType ?? row.dataType;
      const dataText =
        raw !== null && raw !== undefined
          ? formatRawValue(raw, childType)
          : null;
      children.push({
        ...row,
        // 子行 key：父 rowId + 序号（与 SortableContext 父行 id 区分，不可拖拽/多选）。
        rowId: `${row.rowId}:c${i}` as RowId,
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
          address: baseAddress + i,
          dataText,
        },
      });
    }
    return { ...row, children } as TreeRow;
  });
}

