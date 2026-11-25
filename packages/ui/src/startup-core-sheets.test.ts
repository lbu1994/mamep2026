import { beforeEach, describe, expect, it } from "vitest";
import {
  CORE_TABLE_TYPES,
  createEmptyWorkspace,
  createRegisterSheet,
  defaultConfig,
} from "@mamep2026/domain";
import { useAppStore } from "./app-store";
import { ensureCoreSheets } from "./sheet-naming";
import { initI18n } from "./i18n";

beforeEach(() => {
  initI18n();
  useAppStore.getState().setWorkspace(createEmptyWorkspace());
  useAppStore.setState({ loaded: false });
});

describe("startup core sheets", () => {
  it("completes first startup with four types in one notification and no history", () => {
    const before = useAppStore.getState();
    const updates: boolean[] = [];
    const unsubscribe = useAppStore.subscribe((state) => {
      updates.push(state.loaded);
      expect(
        CORE_TABLE_TYPES.every(({ id }) =>
          state.workspace.sheets.some((sheet) => sheet.type === id),
        ),
      ).toBe(true);
    });
    before.setLoaded();
    unsubscribe();
    const after = useAppStore.getState();
    expect(updates).toEqual([true]);
    expect(after.workspace.sheets.map((sheet) => sheet.name)).toEqual([
      "HOLDING REGISTERS Sheet 1",
      "COILS Sheet 1",
      "DISCRETE INPUTS Sheet 1",
      "INPUT REGISTERS Sheet 1",
    ]);
    expect(after.workspace.sheets[0]).toBe(before.workspace.sheets[0]);
    expect(after.workspace.activeSheetId).toBe(before.workspace.activeSheetId);
    expect(after.undoStack).toEqual([]);
    expect(after.redoStack).toEqual([]);
    for (const sheet of after.workspace.sheets) {
      expect(sheet.rows).toHaveLength(
        defaultConfig.registerTable.defaultRowCount,
      );
      expect(
        sheet.rows.every((row) => !row.pollingEnabled && !row.traceEnabled),
      ).toBe(true);
    }
    expect(after.connectionState).toBe("disconnected");
  });

  it("retains closed core sheets and plugin data, allocating only missing types", () => {
    const base = createEmptyWorkspace();
    const closed = {
      ...createRegisterSheet("COILS Sheet 8", 7, "coil"),
      open: false,
    };
    const plugin = createRegisterSheet(
      "INPUT REGISTERS Sheet 4",
      12,
      "vendor:registers",
    );
    const workspace = {
      ...base,
      sheets: [...base.sheets, closed, plugin],
      activeSheetId: plugin.sheetId,
      sheetNameCounters: {
        "holding-register": 2,
        coil: 9,
        "input-register": 4,
      },
    };
    const result = ensureCoreSheets(workspace);
    expect(result.sheets.slice(0, 3)).toEqual(workspace.sheets);
    expect(result.sheets[1]).toBe(closed);
    expect(result.sheets[2]).toBe(plugin);
    expect(result.activeSheetId).toBe(plugin.sheetId);
    expect(
      result.sheets.slice(3).map((sheet) => [sheet.name, sheet.order]),
    ).toEqual([
      ["DISCRETE INPUTS Sheet 1", 13],
      ["INPUT REGISTERS Sheet 5", 14],
    ]);
    expect(result.sheetNameCounters?.coil).toBe(9);
    expect(ensureCoreSheets(result)).toBe(result);
  });

  it("does not read existing rows while filling or checking core types", () => {
    const workspace = createEmptyWorkspace();
    const first = workspace.sheets[0];
    if (first === undefined) throw new Error("Missing sheet.");
    Object.defineProperty(first, "rows", {
      get() {
        throw new Error("Startup must not traverse existing rows.");
      },
    });
    const prepared = ensureCoreSheets(workspace);
    expect(prepared.sheets[0]).toBe(first);
    expect(ensureCoreSheets(prepared)).toBe(prepared);
  });

  it("reuses a complete workspace and does not duplicate tables on repeated startup", () => {
    const store = useAppStore.getState();
    store.setLoaded();
    const complete = useAppStore.getState().workspace;
    store.setWorkspace(complete);
    useAppStore.setState({ loaded: false });
    store.setLoaded();
    expect(useAppStore.getState().workspace).toBe(complete);
    store.setLoaded();
    expect(useAppStore.getState().workspace).toBe(complete);
  });

  it("fills an empty workspace and selects a new holding sheet", () => {
    const prepared = ensureCoreSheets({
      ...createEmptyWorkspace(),
      sheets: [],
      activeSheetId: null,
    });
    expect(prepared.sheets.map((sheet) => sheet.type)).toEqual(
      CORE_TABLE_TYPES.map(({ id }) => id),
    );
    expect(prepared.activeSheetId).toBe(prepared.sheets[0]?.sheetId);
  });
});
