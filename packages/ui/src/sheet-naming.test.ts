import { beforeEach, describe, expect, it } from "vitest";
import {
  createEmptyWorkspace,
  createRegisterSheet,
  type SheetId,
} from "@mamep2026/domain";
import { parseWorkspace, serializeWorkspace } from "@mamep2026/workspace";
import { useAppStore } from "./app-store";
import { initI18n } from "./i18n";
import { createNamedWorkspace } from "./sheet-naming";

function names(): string[] {
  return useAppStore.getState().workspace.sheets.map((sheet) => sheet.name);
}

function activeId(): SheetId {
  const state = useAppStore.getState();
  const id = state.activeSheetId ?? state.workspace.activeSheetId;
  if (id === null) throw new Error("Missing active sheet.");
  return id;
}

beforeEach(() => {
  initI18n();
  useAppStore.getState().setWorkspace(createNamedWorkspace());
});

describe("default sheet names", () => {
  it("uses the same initial name in UI and host-created workspaces", () => {
    const hostWorkspace = createEmptyWorkspace();
    expect(names()).toEqual(["HOLDING REGISTERS Sheet 1"]);
    expect(hostWorkspace.sheets[0]?.name).toBe(names()[0]);
    expect(hostWorkspace.sheetNameCounters).toEqual({ "holding-register": 2 });
  });

  it("numbers each core type independently and always uses English", () => {
    initI18n("zh-CN");
    const store = useAppStore.getState();
    store.addSheet("coil");
    store.addSheet("input-register");
    store.addSheet("discrete-input");
    store.addSheet("coil");
    store.addSheet();
    expect(names()).toEqual([
      "HOLDING REGISTERS Sheet 1",
      "COILS Sheet 1",
      "INPUT REGISTERS Sheet 1",
      "DISCRETE INPUTS Sheet 1",
      "COILS Sheet 2",
      "HOLDING REGISTERS Sheet 2",
    ]);
  });

  it("preserves counters after rename, delete, save and reload", () => {
    const store = useAppStore.getState();
    store.addSheet("coil");
    store.renameSheet(activeId(), "Motor");
    store.addSheet("coil");
    store.deleteSheet(activeId());
    const parsed = parseWorkspace(
      JSON.parse(serializeWorkspace(useAppStore.getState().workspace)),
    );
    if (!parsed.ok) throw new Error("Workspace did not round-trip.");
    store.setWorkspace(parsed.value);
    store.addSheet("coil");
    expect(names()).toEqual([
      "HOLDING REGISTERS Sheet 1",
      "Motor",
      "COILS Sheet 3",
    ]);
  });

  it("recovers old counters before a legacy name is renamed or deleted", () => {
    const legacy = createEmptyWorkspace();
    delete legacy.sheetNameCounters;
    legacy.sheets = [
      createRegisterSheet("Sheet 9", 0),
      createRegisterSheet("COILS Sheet 12", 1, "coil"),
      createRegisterSheet("Keep this name", 2, "input-register"),
    ];
    const store = useAppStore.getState();
    store.setWorkspace(legacy);
    expect(names()).toEqual(["Sheet 9", "COILS Sheet 12", "Keep this name"]);
    const first = legacy.sheets[0];
    const coil = legacy.sheets[1];
    if (first === undefined || coil === undefined)
      throw new Error("Missing legacy sheet.");
    store.renameSheet(first.sheetId, "Old registers");
    store.deleteSheet(coil.sheetId);
    store.addSheet("coil");
    store.addSheet();
    expect(names()).toEqual([
      "Old registers",
      "COILS Sheet 13",
      "Keep this name",
      "COILS Sheet 14",
      "HOLDING REGISTERS Sheet 10",
    ]);
  });

  it("skips names occupied by closed sheets of another type", () => {
    const store = useAppStore.getState();
    const original = activeId();
    store.renameSheet(original, "COILS Sheet 1");
    store.closeSheet(original);
    store.addSheet("coil");
    expect(names()).toEqual(["COILS Sheet 1", "COILS Sheet 2"]);
  });

  it("does not reuse numbers after undo and retains the same name on redo", () => {
    const store = useAppStore.getState();
    store.addSheet("coil");
    const id = activeId();
    store.undo();
    store.redo();
    expect(
      useAppStore
        .getState()
        .workspace.sheets.find((sheet) => sheet.sheetId === id)?.name,
    ).toBe("COILS Sheet 1");
    store.undo();
    store.addSheet("coil");
    expect(names()).toEqual([
      "HOLDING REGISTERS Sheet 1",
      "COILS Sheet 2",
      "COILS Sheet 3",
    ]);
  });

  it("uses the next number for fallback sheets without renaming restored sheets", () => {
    const store = useAppStore.getState();
    const original = activeId();
    store.deleteSheet(original);
    expect(names()).toEqual(["HOLDING REGISTERS Sheet 2"]);
    store.undo();
    expect(names()).toEqual(["HOLDING REGISTERS Sheet 1"]);
    store.redo();
    expect(names()).toEqual(["HOLDING REGISTERS Sheet 2"]);
    store.addSheet();
    expect(names()).toEqual([
      "HOLDING REGISTERS Sheet 2",
      "HOLDING REGISTERS Sheet 3",
    ]);
  });

  it("checks duplicate names and preserves the source type", () => {
    const store = useAppStore.getState();
    store.addSheet("coil");
    const source = activeId();
    store.duplicateSheet(source);
    store.closeSheet(activeId());
    store.duplicateSheet(source);
    expect(names()).toEqual([
      "HOLDING REGISTERS Sheet 1",
      "COILS Sheet 1",
      "COILS Sheet 1 Copy 2",
      "COILS Sheet 1 Copy",
    ]);
    expect(
      useAppStore
        .getState()
        .workspace.sheets.slice(1)
        .every((sheet) => sheet.type === "coil"),
    ).toBe(true);
    store.addSheet("coil");
    expect(names().at(-1)).toBe("COILS Sheet 2");
  });

  it("uses plugin English titles and keeps plugin counters separate", () => {
    const store = useAppStore.getState();
    store.addSheet("vendor:registers", "Vendor Registers (R/W)");
    store.addSheet("other:registers", "Vendor Registers (R/W)");
    store.addSheet("vendor:registers", "Vendor Registers (R/W)");
    expect(names()).toEqual([
      "HOLDING REGISTERS Sheet 1",
      "Vendor Registers Sheet 1",
      "Vendor Registers Sheet 2",
      "Vendor Registers Sheet 3",
    ]);
  });

  it("rejects exhausted legacy counters without changing the workspace", () => {
    const legacy = createEmptyWorkspace(`Sheet ${Number.MAX_SAFE_INTEGER}`);
    delete legacy.sheetNameCounters;
    const store = useAppStore.getState();
    store.setWorkspace(legacy);
    const before = useAppStore.getState().workspace;
    expect(() => store.addSheet()).toThrow("Sheet name counter is exhausted.");
    expect(useAppStore.getState().workspace).toBe(before);
  });
});
