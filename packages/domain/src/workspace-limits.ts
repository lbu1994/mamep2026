import { createMamepError } from "./errors";
import { fail, ok, type Result } from "./result";

/** Maximum register count in one row, including the full 16-bit address space. */
export const MAX_ROW_REGISTER_COUNT = 65_536;
/** Maximum parent, register-child and bit-detail rows across all sheets. */
export const MAX_WORKSPACE_EXPANDED_ROWS = 100_000;
/** Number of bit-detail rows generated for one binary register. */
export const BITS_PER_REGISTER = 16;

/** Accept only finite integer counts within the shared per-row limit. */
export function isWorkspaceRegisterCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_ROW_REGISTER_COUNT
  );
}

function invalidExpansion(detail: string): Result<never> {
  return fail(
    createMamepError({
      code: "WORKSPACE_SCHEMA_INVALID",
      category: "persistence",
      userMessageKey: "errors.workspaceSchemaInvalid",
      technicalMessage: detail,
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Count tree rows without creating children. Reject the entire input on failure.
 * sourceVersion is supplied only before migration: v1/v2 rows become single
 * registers, and v3 range metadata is replaced with the parent data type.
 */
export function validateRowExpansion(
  rows: Iterable<unknown>,
  sourceVersion?: number,
): Result<void> {
  let expandedRows = 0;
  let rowIndex = 0;
  for (const row of rows) {
    if (!isRecord(row))
      return invalidExpansion(`row ${rowIndex} must be an object`);
    const storedCount = row.registerCount === undefined ? 1 : row.registerCount;
    if (!isWorkspaceRegisterCount(storedCount)) {
      return invalidExpansion(
        `row ${rowIndex}: registerCount must be an integer from 1 to ${MAX_ROW_REGISTER_COUNT}`,
      );
    }
    const count =
      sourceVersion !== undefined && sourceVersion < 3 ? 1 : storedCount;
    expandedRows += 1 + (count > 1 ? count : 0);
    if (expandedRows > MAX_WORKSPACE_EXPANDED_ROWS) {
      return invalidExpansion(
        `workspace expansion exceeds ${MAX_WORKSPACE_EXPANDED_ROWS} rows`,
      );
    }
    // Migration v3 replaces metadata; count the type that will reach the UI.
    const metadata =
      sourceVersion !== undefined && sourceVersion <= 3 ? null : row.registers;
    for (let registerIndex = 0; registerIndex < count; registerIndex += 1) {
      const child =
        count > 1 && Array.isArray(metadata) ? metadata[registerIndex] : null;
      const dataType = isRecord(child)
        ? (child.dataType ?? row.dataType)
        : row.dataType;
      if (dataType === "binary") expandedRows += BITS_PER_REGISTER;
      if (expandedRows > MAX_WORKSPACE_EXPANDED_ROWS) {
        return invalidExpansion(
          `workspace expansion exceeds ${MAX_WORKSPACE_EXPANDED_ROWS} rows`,
        );
      }
    }
    rowIndex += 1;
  }
  return ok(undefined);
}

/** Check every sheet, including closed sheets, before migration or Schema cloning. */
export function validateWorkspaceExpansion(
  input: unknown,
  sourceVersion?: number,
): Result<void> {
  if (!isRecord(input) || !Array.isArray(input.sheets)) {
    return invalidExpansion("workspace sheets must be an array");
  }
  const sheets: unknown[] = input.sheets;
  for (const sheet of sheets) {
    if (!isRecord(sheet) || !Array.isArray(sheet.rows)) {
      return invalidExpansion("sheet rows must be an array");
    }
  }
  // Iterate across sheets without flattening or allocating another row array.
  function* rows(): Iterable<unknown> {
    for (const sheet of sheets) {
      if (isRecord(sheet) && Array.isArray(sheet.rows)) yield* sheet.rows;
    }
  }
  return validateRowExpansion(rows(), sourceVersion);
}
