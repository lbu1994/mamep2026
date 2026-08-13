/**
 * 寄存器行操作（不可变更新，docs/TECH_DESIGN.md §6.8）。
 * 行号只表示表格顺序，不等于寄存器地址；增删移动后自动重排。
 */
import {
  createEmptyRow,
  newRowId,
  type RegisterRow,
  type RegisterSheet,
} from "@mamep2026/domain";

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
