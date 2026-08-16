/**
 * 寄存器行操作（不可变更新，docs/TECH_DESIGN.md §6.8）。
 * 行号只表示表格顺序，不等于寄存器地址；增删移动后自动重排。
 */
import {
  createEmptyRow,
  newRowId,
  RawRegisterValue,
  type RegisterRow,
  type RegisterSheet,
  type Result,
} from "@mamep2026/domain";
import { ok } from "@mamep2026/domain";
import { formatRawValue } from "@mamep2026/data-conversion";

/** 应用读取成功结果：按 Type 格式化并强制覆盖单元格（单一当前值模型，§15.1）。 */
export function applyReadValueToRow(
  row: RegisterRow,
  raw: number,
): Result<RegisterRow> {
  const rawValue = RawRegisterValue.create(raw);
  if (!rawValue.ok) return rawValue;
  return ok({
    ...row,
    cellText: formatRawValue(raw, row.dataType),
    lastKnownRawValue: rawValue.value,
    updatedAt: Date.now(),
  });
}

export function renumberRows(rows: readonly RegisterRow[]): RegisterRow[] {
  return rows.map((row, index) => ({ ...row, order: index + 1 }));
}

export function addRowAfter(
  sheet: RegisterSheet,
  afterRowId: string,
): RegisterSheet {
  const index = sheet.rows.findIndex((row) => row.rowId === afterRowId);
  const newRow = createEmptyRow();
  const rows =
    index === -1
      ? [...sheet.rows, newRow]
      : [
          ...sheet.rows.slice(0, index + 1),
          newRow,
          ...sheet.rows.slice(index + 1),
        ];
  return { ...sheet, rows: renumberRows(rows), updatedAt: Date.now() };
}

export function deleteRow(sheet: RegisterSheet, rowId: string): RegisterSheet {
  return {
    ...sheet,
    rows: renumberRows(sheet.rows.filter((row) => row.rowId !== rowId)),
    updatedAt: Date.now(),
  };
}

export function moveRow(
  sheet: RegisterSheet,
  rowId: string,
  direction: "up" | "down",
): RegisterSheet {
  const index = sheet.rows.findIndex((row) => row.rowId === rowId);
  if (index === -1) return sheet;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= sheet.rows.length) return sheet;
  const rows = [...sheet.rows];
  const moved = rows[index];
  if (moved === undefined) return sheet;
  rows[index] = rows[targetIndex] ?? moved;
  rows[targetIndex] = moved;
  return { ...sheet, rows: renumberRows(rows), updatedAt: Date.now() };
}

export function duplicateRow(
  sheet: RegisterSheet,
  rowId: string,
): RegisterSheet {
  const index = sheet.rows.findIndex((row) => row.rowId === rowId);
  const source = sheet.rows[index];
  if (source === undefined) return sheet;
  const copy: RegisterRow = {
    ...source,
    rowId: newRowId(),
    // 复制行不继承运行时开关与结果值。
    pollingEnabled: false,
    traceEnabled: false,
    cellText: "",
    lastKnownRawValue: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const rows = [
    ...sheet.rows.slice(0, index + 1),
    copy,
    ...sheet.rows.slice(index + 1),
  ];
  return { ...sheet, rows: renumberRows(rows), updatedAt: Date.now() };
}

/**
 * 按目标索引移动单行（dnd-kit 拖拽排序用）：语义与 `arrayMove(rows, activeIndex, targetIndex)` 一致——
 * 先移除该行，再插入到目标索引，其余行相应移位；`targetIndex` 越界时钳制到有效范围。
 * 行号自动重排（复用 `renumberRows`），并更新 `updatedAt`。
 * 行不存在或目标索引等于当前位置时为 no-op（原样返回 sheet）。
 */
export function moveRowToIndex(
  sheet: RegisterSheet,
  rowId: string,
  targetIndex: number,
): RegisterSheet {
  const index = sheet.rows.findIndex((row) => row.rowId === rowId);
  if (index === -1) return sheet;
  const lastIndex = sheet.rows.length - 1;
  const clamped = Math.max(0, Math.min(targetIndex, lastIndex));
  if (index === clamped) return sheet;
  const rows = [...sheet.rows];
  const [moved] = rows.splice(index, 1);
  if (moved === undefined) return sheet;
  rows.splice(clamped, 0, moved);
  return { ...sheet, rows: renumberRows(rows), updatedAt: Date.now() };
}

/** 在指定行之前插入空行（不继承字段）；目标行不存在时追加末尾。 */
export function insertRowBefore(
  sheet: RegisterSheet,
  rowId: string,
): RegisterSheet {
  const index = sheet.rows.findIndex((row) => row.rowId === rowId);
  const newRow = createEmptyRow();
  const rows =
    index === -1
      ? [...sheet.rows, newRow]
      : [...sheet.rows.slice(0, index), newRow, ...sheet.rows.slice(index)];
  return { ...sheet, rows: renumberRows(rows), updatedAt: Date.now() };
}

/**
 * 批量移动：把选中行作为有序集合整体上/下移一个位置（与最近的非选中行交换），
 * 保持选中行之间的相对顺序；边界或全选时为 no-op。
 */
export function moveRows(
  sheet: RegisterSheet,
  rowIds: readonly string[],
  direction: "up" | "down",
): RegisterSheet {
  const idSet = new Set(rowIds);
  const rows = [...sheet.rows];
  if (direction === "up") {
    for (let i = 0; i < rows.length; i += 1) {
      const current = rows[i];
      if (current !== undefined && idSet.has(current.rowId) && i > 0) {
        const above = rows[i - 1];
        if (above !== undefined && !idSet.has(above.rowId)) {
          rows[i] = above;
          rows[i - 1] = current;
        }
      }
    }
  } else {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const current = rows[i];
      if (
        current !== undefined &&
        idSet.has(current.rowId) &&
        i < rows.length - 1
      ) {
        const below = rows[i + 1];
        if (below !== undefined && !idSet.has(below.rowId)) {
          rows[i] = below;
          rows[i + 1] = current;
        }
      }
    }
  }
  return { ...sheet, rows: renumberRows(rows), updatedAt: Date.now() };
}

/** 批量删除行并重编号。 */
export function deleteRows(
  sheet: RegisterSheet,
  rowIds: readonly string[],
): RegisterSheet {
  const idSet = new Set(rowIds);
  return {
    ...sheet,
    rows: renumberRows(sheet.rows.filter((row) => !idSet.has(row.rowId))),
    updatedAt: Date.now(),
  };
}
