/**
 * 撤销/重做核心（docs/TECH_DESIGN.md §24.4，PRD §8.3 P1）。
 *
 * 设计要点：
 * - 撤销栈只处理「工作区编辑操作」：新增行、删除行、移动行、改名、改地址、改 Type、
 *   改轮询设置、粘贴、范围行编辑、标签页操作、每表配置（radix/slaveAddress/writeVerify）。
 * - 不撤销：设备读取结果（cellText/registerValues 运行时值）、Data 单元格文本修改、
 *   已经发送的写入、连接和断开、通信日志、设备产生的外部状态。
 * - 实现为「编辑字段快照」：撤销/重做时只回退结构化编辑字段（RowEditFields），
 *   保留行当前运行时字段（cellText/registerValues 等读值），符合 §24.4「不撤销设备读取结果」。
 * - 被增删的行/表需要完整行快照（full）：撤销删除时用完整行重建（含当时的 cellText/registerValues），
 *   因为「撤销删除」的语义是回到删除前状态。
 * - 纯函数、不可变、可单测；不依赖任何 UI / store 框架。
 */
import {
  type AddressTransformConfig,
  type DataType,
  type ReadVerifySettings,
  type RegisterAddress,
  type RegisterRadix,
  type RegisterRow,
  type RegisterSheet,
  type RegisterSubRowMeta,
  type RowId,
  type SheetId,
  type SheetType,
} from "@mamep2026/domain";
import { renumberRows } from "./row-operations";

/** 撤销栈容量上限（丢弃最旧条目，防止无限增长）。 */
export const UNDO_LIMIT_DEFAULT = 100;

/**
 * 行编辑字段：撤销/重做只回退这些字段。
 * cellText / registerValues（读值与 Data 文本）、order（行号）、traceEnabled（运行时追踪开关）、
 * createdAt / updatedAt（时间戳）等运行时字段不回退。
 */
export interface RowEditFields {
  name: string;
  comment: string;
  addressDraft: string;
  addressValue: RegisterAddress | null;
  registerCount: number;
  dataType: DataType;
  pollingEnabled: boolean;
  /** 范围行子行元数据（2026-08-27）：null=单寄存器行或老数据。 */
  registers: RegisterSubRowMeta[] | null;
}

/** 提取行的编辑字段（浅拷贝 registers，避免与当前行共享引用）。 */
export function extractRowEditFields(row: RegisterRow): RowEditFields {
  return {
    name: row.name,
    comment: row.comment,
    addressDraft: row.addressDraft,
    addressValue: row.addressValue,
    registerCount: row.registerCount,
    dataType: row.dataType,
    pollingEnabled: row.pollingEnabled,
    registers: row.registers === null ? null : [...row.registers],
  };
}

/**
 * 把编辑字段应用到现有行：保留运行时字段（cellText/registerValues/order/traceEnabled 等）。
 * 范围长度变化后旧读值不再对齐时清空 registerValues（与 commitAddress 语义一致，ADR-030）。
 */
export function applyRowEditFields(
  row: RegisterRow,
  fields: RowEditFields,
): RegisterRow {
  const next: RegisterRow = {
    ...row,
    name: fields.name,
    comment: fields.comment,
    addressDraft: fields.addressDraft,
    addressValue: fields.addressValue,
    registerCount: fields.registerCount,
    dataType: fields.dataType,
    pollingEnabled: fields.pollingEnabled,
    registers: fields.registers,
    updatedAt: Date.now(),
  };
  if (
    next.registerValues !== null &&
    next.registerValues.length !== fields.registerCount
  ) {
    next.registerValues = null;
  }
  return next;
}

/** 行快照：edit=编辑字段；full=完整行（行在恢复时不存在——被删除的行/表——用完整行重建）。 */
export interface RowSnapshot {
  rowId: RowId;
  edit: RowEditFields;
  full: RegisterRow;
}

/** 表的编辑结构快照：表配置字段 + 每行的编辑字段/完整行。 */
export interface SheetEditSnapshot {
  sheetId: SheetId;
  name: string;
  /** 表类型（ADR-041）：撤销/重做携带，重建时保留插件表类型。 */
  type: SheetType;
  order: number;
  open: boolean;
  registerRadix: RegisterRadix;
  slaveAddress: number;
  writeVerify: ReadVerifySettings;
  /** 表级地址变换配置（ADR-042）：撤销/重做携带。 */
  addressTransform: AddressTransformConfig | null;
  rows: RowSnapshot[];
}

/** 对一张表生成编辑结构快照（full 为行引用：行对象不可变更新，快照引用安全）。 */
export function snapshotSheet(sheet: RegisterSheet): SheetEditSnapshot {
  return {
    sheetId: sheet.sheetId,
    name: sheet.name,
    type: sheet.type,
    order: sheet.order,
    open: sheet.open,
    registerRadix: sheet.registerRadix,
    slaveAddress: sheet.slaveAddress,
    writeVerify: sheet.writeVerify,
    addressTransform: sheet.addressTransform,
    rows: sheet.rows.map((row) => ({
      rowId: row.rowId,
      edit: extractRowEditFields(row),
      full: row,
    })),
  };
}

/**
 * 把当前表恢复为快照描述的编辑结构：
 * - 快照中的行当前存在 → 恢复编辑字段、保留当前运行时字段（读值不回退）；
 * - 快照中的行当前不存在（被删除）→ 用 full 完整行重建；
 * - 当前存在但快照中没有的行（编辑后新增）→ 移除。
 * 同时恢复表配置字段并按行顺序重编号。
 */
export function applySheetSnapshot(
  current: RegisterSheet,
  snapshot: SheetEditSnapshot,
): RegisterSheet {
  const currentRows = new Map(current.rows.map((row) => [row.rowId, row]));
  const rows: RegisterRow[] = [];
  for (const snap of snapshot.rows) {
    const existing = currentRows.get(snap.rowId);
    rows.push(
      existing !== undefined
        ? applyRowEditFields(existing, snap.edit)
        : snap.full,
    );
  }
  return {
    ...current,
    name: snapshot.name,
    type: snapshot.type,
    order: snapshot.order,
    open: snapshot.open,
    registerRadix: snapshot.registerRadix,
    slaveAddress: snapshot.slaveAddress,
    writeVerify: snapshot.writeVerify,
    addressTransform: snapshot.addressTransform,
    rows: renumberRows(rows),
    updatedAt: Date.now(),
  };
}

/** 从快照重建一张表（表当前不存在时用；行全部用 full 完整行重建）。 */
export function sheetFromSnapshot(
  snapshot: SheetEditSnapshot,
): RegisterSheet {
  return {
    sheetId: snapshot.sheetId,
    name: snapshot.name,
    type: snapshot.type,
    order: snapshot.order,
    open: snapshot.open,
    rows: renumberRows(snapshot.rows.map((snap) => snap.full)),
    registerRadix: snapshot.registerRadix,
    slaveAddress: snapshot.slaveAddress,
    // 布局（列宽/列序）不纳入撤销（用户决策），重建时用默认。
    columnWidths: {},
    columnOrder: null,
    writeVerify: snapshot.writeVerify,
    addressTransform: snapshot.addressTransform,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * 撤销条目：
 * - kind="sheet"：单表内容/配置编辑。before=编辑前快照（null=编辑前表不存在，如新增表）；
 *   after=编辑后快照（null=编辑后表不存在，如删除表）。
 *   removeFallback：删除唯一表时 UI 会重建默认空表；撤销删除时需移除该保底表
 *   （仅删除唯一表的场景设置，此时 undo 后应只保留被恢复的表）。
 * - kind="sheets-reorder"：表顺序重排（拖拽移动表；只记录 sheetId 顺序）。
 */
export type UndoEntry =
  | {
      kind: "sheet";
      sheetId: SheetId;
      before: SheetEditSnapshot | null;
      after: SheetEditSnapshot | null;
      removeFallback?: boolean;
    }
  | {
      kind: "sheets-reorder";
      before: SheetId[];
      after: SheetId[];
    };

export interface UndoRedoState {
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
}

export function createUndoRedoState(): UndoRedoState {
  return { undoStack: [], redoStack: [] };
}

/** 入栈一个新编辑条目：清空重做栈（新操作截断重做分支）；超过容量丢弃最旧条目。 */
export function pushEntry(
  state: UndoRedoState,
  entry: UndoEntry,
  options: { limit?: number } = {},
): UndoRedoState {
  const limit = options.limit ?? UNDO_LIMIT_DEFAULT;
  const undoStack = [...state.undoStack, entry];
  const trimmed =
    undoStack.length > limit ? undoStack.slice(undoStack.length - limit) : undoStack;
  return { undoStack: trimmed, redoStack: [] };
}

export function clearHistory(_state: UndoRedoState): UndoRedoState {
  return { undoStack: [], redoStack: [] };
}

export function canUndo(state: UndoRedoState): boolean {
  return state.undoStack.length > 0;
}

export function canRedo(state: UndoRedoState): boolean {
  return state.redoStack.length > 0;
}

/** 弹出栈顶撤销条目（undo 用）；返回更新后的状态与条目（空栈返回 null）。 */
export function popUndo(
  state: UndoRedoState,
): { state: UndoRedoState; entry: UndoEntry | null } {
  const entry = state.undoStack[state.undoStack.length - 1] ?? null;
  if (entry === null) return { state, entry: null };
  return {
    state: { undoStack: state.undoStack.slice(0, -1), redoStack: state.redoStack },
    entry,
  };
}

/** 弹出栈顶重做条目（redo 用）。 */
export function popRedo(
  state: UndoRedoState,
): { state: UndoRedoState; entry: UndoEntry | null } {
  const entry = state.redoStack[state.redoStack.length - 1] ?? null;
  if (entry === null) return { state, entry: null };
  return {
    state: { redoStack: state.redoStack.slice(0, -1), undoStack: state.undoStack },
    entry,
  };
}

/** 撤销后把条目放回重做栈（redone 状态）。 */
export function pushRedo(
  state: UndoRedoState,
  entry: UndoEntry,
): UndoRedoState {
  return { ...state, redoStack: [...state.redoStack, entry] };
}

/** 重做后把条目放回撤销栈。 */
export function pushUndo(
  state: UndoRedoState,
  entry: UndoEntry,
): UndoRedoState {
  return { ...state, undoStack: [...state.undoStack, entry] };
}
