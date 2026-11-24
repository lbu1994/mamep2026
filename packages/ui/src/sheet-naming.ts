import {
  CORE_TABLE_TYPES,
  createEmptyWorkspace,
  createRegisterSheet,
  type RegisterSheet,
  type SheetType,
  type Workspace,
} from "@mamep2026/domain";
import { en } from "./i18n";

/** Read the English resource without depending on the active UI language. */
export function sheetTypeName(type: SheetType, englishTitle?: string): string {
  const meta = CORE_TABLE_TYPES.find((candidate) => candidate.id === type);
  const title =
    meta === undefined
      ? (englishTitle ?? type)
      : (Object.entries(en.table.tableType).find(
          ([key]) => `table.tableType.${key}` === meta.titleKey,
        )?.[1] ?? type);
  return title.replace(/\s*\((?:R\/W|R|W)\)\s*$/, "").trim();
}

/** Preserve allocated numbers and recover missing counters from existing names. */
export function initializeSheetNameCounters(workspace: Workspace): Workspace {
  const counters = { ...workspace.sheetNameCounters };
  let changed = workspace.sheetNameCounters === undefined;
  for (const sheet of workspace.sheets) {
    // Accept both legacy "Sheet N" and typed "<title> Sheet N" names.
    const match = /(?:^| )Sheet ([1-9]\d*)$/.exec(sheet.name);
    const suffix = match === null ? 0 : Number(match[1]);
    const next = Number.isSafeInteger(suffix)
      ? Math.min(suffix + 1, Number.MAX_SAFE_INTEGER)
      : 1;
    const previous = Object.hasOwn(counters, sheet.type)
      ? counters[sheet.type]
      : undefined;
    if (previous === undefined || previous < next) {
      counters[sheet.type] = next;
      changed = true;
    }
  }
  return changed ? { ...workspace, sheetNameCounters: counters } : workspace;
}

/** Allocate a unique name and advance only this type's persisted counter. */
export function createNamedSheet(
  workspace: Workspace,
  type: SheetType = "holding-register",
  englishTitle?: string,
): { sheet: RegisterSheet; workspace: Workspace } {
  const initialized = initializeSheetNameCounters(workspace);
  const counters = initialized.sheetNameCounters ?? {};
  let number = Object.hasOwn(counters, type) ? (counters[type] ?? 1) : 1;
  const prefix = `${sheetTypeName(type, englishTitle)} Sheet `;
  const names = new Set(workspace.sheets.map((sheet) => sheet.name));
  while (names.has(`${prefix}${number}`) && number < Number.MAX_SAFE_INTEGER) {
    number += 1;
  }
  if (number >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Sheet name counter is exhausted.");
  }
  return {
    sheet: createRegisterSheet(
      `${prefix}${number}`,
      workspace.sheets.length,
      type,
    ),
    workspace: {
      ...initialized,
      sheetNameCounters: { ...counters, [type]: number + 1 },
    },
  };
}

/** Keep fresh UI workspaces aligned with the English table-type resources. */
export function createNamedWorkspace(): Workspace {
  return createEmptyWorkspace(`${sheetTypeName("holding-register")} Sheet 1`);
}

/** Keep the Copy suffix while avoiding names on both open and closed sheets. */
export function copySheetName(
  workspace: Workspace,
  sourceName: string,
): string {
  const names = new Set(workspace.sheets.map((sheet) => sheet.name));
  const base = `${sourceName} Copy`;
  let name = base;
  let number = 2;
  while (names.has(name)) {
    name = `${base} ${number}`;
    number += 1;
  }
  return name;
}
