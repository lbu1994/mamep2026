import { describe, expect, it } from "vitest";
import {
  createRegisterSheet,
  createEmptyRow,
  RawRegisterValue,
  type RegisterRow,
  type RegisterSheet,
  type SheetId,
} from "@mamep2026/domain";
import {
  applyRowEditFields,
  applySheetSnapshot,
  canRedo,
  canUndo,
  clearHistory,
  createUndoRedoState,
  extractRowEditFields,
  popRedo,
  popUndo,
  pushEntry,
  pushRedo,
  pushUndo,
  sheetFromSnapshot,
  snapshotSheet,
  UNDO_LIMIT_DEFAULT,
} from "./undo-redo";
import { renumberRows } from "./row-operations";

function raw(v: number): RawRegisterValue {
  const created = RawRegisterValue.create(v);
  if (!created.ok) throw new Error("unreachable");
  return created.value;
}

function sheetWithRows(count: number): RegisterSheet {
  const sheet = createRegisterSheet("S", 0);
  sheet.rows = renumberRows(
    Array.from({ length: count }, (_, i) => {
      const row = createEmptyRow();
      row.name = `R${i + 1}`;
      return row;
    }),
  );
  return sheet;
}

function findRow(sheet: RegisterSheet, name: string): RegisterRow | null {
  return sheet.rows.find((r) => r.name === name) ?? null;
}

describe("RowEditFields", () => {
  it("extracts edit fields and round-trips through applyRowEditFields", () => {
    const row = createEmptyRow();
    row.name = "Motor Speed";
    row.comment = "c";
    row.addressDraft = "100";
    row.dataType = "unsigned-0.1";
    row.pollingEnabled = true;
    const fields = extractRowEditFields(row);
    const restored = applyRowEditFields(row, fields);
    expect(restored.name).toBe("Motor Speed");
    expect(restored.comment).toBe("c");
    expect(restored.addressDraft).toBe("100");
    expect(restored.dataType).toBe("unsigned-0.1");
    expect(restored.pollingEnabled).toBe(true);
  });

  it("preserves runtime fields (cellText/registerValues/order/traceEnabled) when applying edit fields", () => {
    const row = createEmptyRow();
    row.name = "old";
    row.cellText = "1234";
    row.registerValues = [raw(1234)];
    row.order = 7;
    row.traceEnabled = true;
    const restored = applyRowEditFields(row, {
      name: "new",
      comment: row.comment,
      addressDraft: row.addressDraft,
      addressValue: row.addressValue,
      registerCount: 1,
      dataType: row.dataType,
      pollingEnabled: row.pollingEnabled,
      registers: row.registers,
      bitComments: row.bitComments,
      bitNames: row.bitNames,
    });
    expect(restored.name).toBe("new");
    // 运行时字段不回退（§24.4「不撤销设备读取结果」）。
    expect(restored.cellText).toBe("1234");
    expect(restored.registerValues).toEqual([raw(1234)]);
    expect(restored.order).toBe(7);
    expect(restored.traceEnabled).toBe(true);
  });

  it("clears registerValues when registerCount changes (values no longer aligned)", () => {
    const row = createEmptyRow();
    row.registerCount = 1;
    row.registerValues = [raw(1)];
    const restored = applyRowEditFields(row, {
      name: row.name,
      comment: row.comment,
      addressDraft: row.addressDraft,
      addressValue: row.addressValue,
      registerCount: 2,
      dataType: row.dataType,
      pollingEnabled: row.pollingEnabled,
      registers: row.registers,
      bitComments: row.bitComments,
      bitNames: row.bitNames,
    });
    expect(restored.registerCount).toBe(2);
    expect(restored.registerValues).toBeNull();
  });
});

describe("snapshotSheet / applySheetSnapshot", () => {
  it("restores edit fields and keeps current read values for existing rows", () => {
    const sheet = sheetWithRows(2);
    const before = snapshotSheet(sheet);
    // 编辑后：改 R1 名字，R1 读值已更新（运行时）。
    let updated = sheet;
    const r1 = findRow(updated, "R1");
    expect(r1).not.toBeNull();
    updated = {
      ...updated,
      rows: renumberRows(
        updated.rows.map((r) =>
          r.rowId === r1?.rowId
            ? { ...r, name: "Renamed", cellText: "9999", registerValues: [raw(9999)] }
            : r,
        ),
      ),
    };
    const restored = applySheetSnapshot(updated, before);
    expect(findRow(restored, "R1")).not.toBeNull();
    expect(findRow(restored, "Renamed")).toBeNull();
    const restoredR1 = findRow(restored, "R1");
    expect(restoredR1).not.toBeNull();
    // 读值不回退（保持编辑后的当前值）。
    expect(restoredR1?.cellText).toBe("9999");
    expect(restoredR1?.registerValues).toEqual([raw(9999)]);
  });

  it("restores bit comments as an edit field and keeps current read values（ADR-052）", () => {
    const sheet = sheetWithRows(1);
    const rowId = sheet.rows[0]?.rowId;
    expect(rowId).toBeDefined();
    const withComments: RegisterSheet = {
      ...sheet,
      rows: sheet.rows.map((row) =>
        row.rowId === rowId
          ? {
              ...row,
              dataType: "binary",
              bitComments: [
                Array.from({ length: 16 }, (_, index) =>
                  index === 0 ? "carry" : "",
                ),
              ],
              cellText: "9999",
              registerValues: [raw(9999)],
            }
          : row,
      ),
    };
    // 快照（含位注释）→ 之后清除注释 → 撤销应用快照：注释回退，读值不回退。
    const before = snapshotSheet(withComments);
    const edited: RegisterSheet = {
      ...withComments,
      rows: withComments.rows.map((row) =>
        row.rowId === rowId ? { ...row, bitComments: null } : row,
      ),
    };
    const restored = applySheetSnapshot(edited, before);
    const restoredRow = findRow(restored, "R1");
    expect(restoredRow?.bitComments?.[0]?.[0]).toBe("carry");
    expect(restoredRow?.cellText).toBe("9999");
    expect(restoredRow?.registerValues).toEqual([raw(9999)]);
  });

  it("restores a deleted row with its full content (undo delete)", () => {
    const sheet = sheetWithRows(3);
    const before = snapshotSheet(sheet);
    const deleted = sheet.rows[1];
    expect(deleted).toBeDefined();
    const afterDelete: RegisterSheet = {
      ...sheet,
      rows: renumberRows(sheet.rows.filter((r) => r.rowId !== deleted!.rowId)),
    };
    const restored = applySheetSnapshot(afterDelete, before);
    expect(restored.rows.map((r) => r.name)).toEqual(["R1", "R2", "R3"]);
    expect(restored.rows.map((r) => r.order)).toEqual([1, 2, 3]);
  });

  it("removes rows added after the snapshot (undo insert)", () => {
    const sheet = sheetWithRows(2);
    const before = snapshotSheet(sheet);
    const added = createEmptyRow();
    added.name = "Added";
    const afterInsert: RegisterSheet = {
      ...sheet,
      rows: renumberRows([...sheet.rows, added]),
    };
    const restored = applySheetSnapshot(afterInsert, before);
    expect(restored.rows.map((r) => r.name)).toEqual(["R1", "R2"]);
  });

  it("restores sheet config fields (radix/slaveAddress/writeVerify/name)", () => {
    const sheet = sheetWithRows(1);
    const before = snapshotSheet(sheet);
    const edited: RegisterSheet = {
      ...sheet,
      registerRadix: "hex",
      slaveAddress: 5,
      writeVerify: { mode: "delayed", delayMs: 200 },
      name: "Renamed Table",
    };
    const restored = applySheetSnapshot(edited, before);
    expect(restored.registerRadix).toBe("dec");
    expect(restored.slaveAddress).toBe(1);
    expect(restored.writeVerify).toEqual({ mode: "immediate", delayMs: null });
    expect(restored.name).toBe("S");
  });

  it("sheetFromSnapshot rebuilds a full sheet with its rows", () => {
    const sheet = sheetWithRows(2);
    const rebuilt = sheetFromSnapshot(snapshotSheet(sheet));
    expect(rebuilt.sheetId).toBe(sheet.sheetId);
    expect(rebuilt.name).toBe("S");
    expect(rebuilt.rows.map((r) => r.name)).toEqual(["R1", "R2"]);
    expect(rebuilt.rows.map((r) => r.order)).toEqual([1, 2]);
  });
});

describe("undo/redo stack state machine", () => {
  const entry = () =>
    ({
      kind: "sheet",
      sheetId: "s1" as SheetId,
      before: null,
      after: null,
    }) as const;

  it("starts empty (canUndo/canRedo false)", () => {
    const state = createUndoRedoState();
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);
  });

  it("pushEntry appends to undo stack and clears redo stack", () => {
    let state = createUndoRedoState();
    state = pushEntry(state, entry());
    state = pushEntry(state, entry());
    expect(state.undoStack).toHaveLength(2);
    expect(canUndo(state)).toBe(true);
    // 模拟一次 undo 后进入 redo，再 push 新编辑 → redo 清空。
    const popped = popUndo(state);
    expect(popped.entry).not.toBeNull();
    state = pushRedo(popped.state, popped.entry!);
    expect(canRedo(state)).toBe(true);
    state = pushEntry(state, entry());
    expect(canRedo(state)).toBe(false);
    expect(state.undoStack).toHaveLength(2);
  });

  it("trims oldest entries beyond the limit", () => {
    let state = createUndoRedoState();
    for (let i = 0; i < UNDO_LIMIT_DEFAULT + 5; i += 1) {
      state = pushEntry(state, entry(), { limit: UNDO_LIMIT_DEFAULT });
    }
    expect(state.undoStack).toHaveLength(UNDO_LIMIT_DEFAULT);
  });

  it("popUndo/popRedo return null on empty stacks", () => {
    const state = createUndoRedoState();
    expect(popUndo(state).entry).toBeNull();
    expect(popRedo(state).entry).toBeNull();
  });

  it("popUndo/popRedo/pushRedo/pushUndo move entries between stacks", () => {
    let state = createUndoRedoState();
    state = pushEntry(state, entry());
    const { state: afterPop, entry: e } = popUndo(state);
    expect(e).not.toBeNull();
    expect(afterPop.undoStack).toHaveLength(0);
    state = pushRedo(afterPop, e!);
    expect(state.redoStack).toHaveLength(1);
    const { state: afterRedoPop, entry: re } = popRedo(state);
    expect(re).not.toBeNull();
    expect(afterRedoPop.redoStack).toHaveLength(0);
    state = pushUndo(afterRedoPop, re!);
    expect(state.undoStack).toHaveLength(1);
  });

  it("clearHistory resets both stacks but keeps current state", () => {
    let state = createUndoRedoState();
    state = pushEntry(state, entry());
    state = clearHistory(state);
    expect(state.undoStack).toHaveLength(0);
    expect(state.redoStack).toHaveLength(0);
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);
  });
});
