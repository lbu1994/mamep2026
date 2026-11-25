import { beforeEach, describe, expect, it } from "vitest";
import {
  CORE_TABLE_TYPES,
  createEmptyWorkspace,
  createRegisterSheet,
  defaultConfig,
  type RegisterSheet,
} from "@mamep2026/domain";
import { useAppStore } from "./app-store";
import { initI18n } from "./i18n";

beforeEach(() => {
  initI18n();
  useAppStore.getState().setWorkspace(createEmptyWorkspace());
});

function loadSheets(sheets: RegisterSheet[], active = sheets[0]): void {
  useAppStore.getState().setWorkspace({
    ...createEmptyWorkspace(),
    sheets,
    activeSheetId: active?.sheetId ?? null,
  });
}

describe("core sheet removal history", () => {
  it.each(CORE_TABLE_TYPES)(
    "replaces the last $id sheet and restores the complete original in one step",
    ({ id, defaultDataType }) => {
      const other = createRegisterSheet("Other", 0, "vendor:registers");
      const source = createRegisterSheet("Custom", 1, id);
      const row = source.rows[0];
      if (row === undefined) throw new Error("Missing default row.");
      const original: RegisterSheet = {
        ...source,
        open: false,
        registerRadix: "hex",
        slaveAddress: 7,
        columnWidths: { name: 240 },
        columnOrder: ["data", "name"],
        addressTransform: {
          transformId: "vendor:offset",
          enabled: true,
        },
        writeVerify: { mode: "delayed", delayMs: 200 },
        rows: [{ ...row, name: "Motor", cellText: "12", pollingEnabled: true }],
      };
      const tail = createRegisterSheet("Tail", 2, "vendor:other");
      loadSheets([other, original, tail], other);
      const store = useAppStore.getState();
      const changes: number[] = [];
      const unsubscribe = useAppStore.subscribe((state) =>
        changes.push(state.undoStack.length),
      );
      store.deleteSheet(original.sheetId);
      unsubscribe();
      expect(changes).toEqual([1]);
      const deleted = useAppStore.getState();
      const replacement = deleted.workspace.sheets[1];
      if (replacement === undefined) throw new Error("Missing replacement.");
      expect(replacement.sheetId).not.toBe(original.sheetId);
      expect(replacement.type).toBe(id);
      expect(replacement.order).toBe(1);
      expect(replacement.open).toBe(true);
      expect(replacement.rows).toHaveLength(
        defaultConfig.registerTable.defaultRowCount,
      );
      expect(
        replacement.rows.every(
          (entry) =>
            entry.dataType === defaultDataType &&
            entry.name === "" &&
            entry.cellText === "" &&
            !entry.pollingEnabled,
        ),
      ).toBe(true);
      expect(deleted.activeSheetId).toBe(replacement.sheetId);
      expect(deleted.workspace.activeSheetId).toBe(replacement.sheetId);
      expect(deleted.workspace.sheets[0]).toBe(other);
      expect(deleted.workspace.sheets[2]).toBe(tail);

      for (let cycle = 0; cycle < 3; cycle += 1) {
        store.undo();
        const restored = useAppStore.getState();
        expect(restored.workspace.sheets).toEqual([other, original, tail]);
        expect(restored.activeSheetId).toBe(other.sheetId);
        expect(restored.workspace.activeSheetId).toBe(other.sheetId);
        expect(restored.undoStack).toHaveLength(0);
        expect(restored.redoStack).toHaveLength(1);
        store.redo();
        expect(useAppStore.getState().workspace.sheets).toEqual(
          deleted.workspace.sheets,
        );
        expect(useAppStore.getState().workspace.sheetNameCounters).toEqual(
          deleted.workspace.sheetNameCounters,
        );
        expect(useAppStore.getState().workspace.activeSheetId).toBe(
          replacement.sheetId,
        );
        expect(useAppStore.getState().activeSheetId).toBe(replacement.sheetId);
      }
    },
  );

  it.each(CORE_TABLE_TYPES)(
    "counts closed $id sheets before allocating a replacement",
    ({ id }) => {
      const first = createRegisterSheet("First", 0, id);
      const closed = { ...createRegisterSheet("Closed", 1, id), open: false };
      const other = createRegisterSheet("Other", 2, "vendor:registers");
      loadSheets([first, closed, other], other);
      const store = useAppStore.getState();
      store.deleteSheet(first.sheetId);
      expect(useAppStore.getState().workspace.sheets).toEqual([closed, other]);
      expect(useAppStore.getState().activeSheetId).toBe(other.sheetId);
      store.undo();
      expect(useAppStore.getState().workspace.sheets).toEqual([
        first,
        closed,
        other,
      ]);
      store.redo();
      expect(useAppStore.getState().workspace.sheets).toEqual([closed, other]);
    },
  );

  it("does not replace a plugin type and keeps the empty-workspace holding fallback", () => {
    const plugin = createRegisterSheet("Plugin", 0, "vendor:registers");
    const holding = createRegisterSheet("Holding", 1);
    loadSheets([plugin, holding]);
    const store = useAppStore.getState();
    store.deleteSheet(plugin.sheetId);
    expect(useAppStore.getState().workspace.sheets).toEqual([holding]);
    loadSheets([plugin]);
    store.deleteSheet(plugin.sheetId);
    const replacement = useAppStore.getState().workspace.sheets[0];
    expect(replacement?.type).toBe("holding-register");
    store.undo();
    expect(useAppStore.getState().workspace.sheets).toEqual([plugin]);
    store.redo();
    expect(useAppStore.getState().workspace.sheets).toEqual([replacement]);
  });

  it("reuses the replacement when undoing creation of the first sheet of a core type", () => {
    const store = useAppStore.getState();
    store.addSheet("coil");
    const created = useAppStore.getState().workspace.sheets;
    store.undo();
    const undone = useAppStore.getState().workspace.sheets;
    expect(undone.map((sheet) => sheet.type)).toEqual([
      "holding-register",
      "coil",
    ]);
    expect(undone[1]?.sheetId).not.toBe(created[1]?.sheetId);
    store.redo();
    expect(useAppStore.getState().workspace.sheets).toEqual(created);
    store.undo();
    expect(useAppStore.getState().workspace.sheets).toEqual(undone);
  });

  it("leaves sheets and history unchanged if replacement naming fails", () => {
    const store = useAppStore.getState();
    store.setWorkspace({
      ...store.workspace,
      sheetNameCounters: { "holding-register": Number.MAX_SAFE_INTEGER },
    });
    const before = useAppStore.getState();
    const first = before.workspace.sheets[0];
    if (first === undefined) throw new Error("Missing sheet.");
    expect(() => store.deleteSheet(first.sheetId)).toThrow(
      "Sheet name counter is exhausted.",
    );
    expect(useAppStore.getState()).toBe(before);
  });
});
