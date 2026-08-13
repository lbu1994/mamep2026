import { describe, expect, it } from "vitest";
import {
  createRegisterSheet,
  createEmptyRow,
  type RegisterSheet,
} from "@mamep2026/domain";
import {
  addRowAfter,
  deleteRow,
  duplicateRow,
  moveRow,
  renumberRows,
} from "./row-operations";

function sheetWithRows(count: number): RegisterSheet {
  const sheet = createRegisterSheet("S", 0);
  const rows = Array.from({ length: count }, (_, i) => {
    const row = createEmptyRow();
    row.name = `R${i + 1}`;
    return row;
  });
  sheet.rows = renumberRows(rows);
  return sheet;
}

describe("row operations", () => {
  it("renumbers rows from 1 after structural changes (row number is not the address)", () => {
    const sheet = sheetWithRows(3);
    expect(sheet.rows.map((r) => r.order)).toEqual([1, 2, 3]);
  });

  it("adds a row after the given row id", () => {
    const sheet = sheetWithRows(2);
    const targetId = sheet.rows[0]?.rowId;
    expect(targetId).toBeDefined();
    const updated = addRowAfter(sheet, targetId as string);
    expect(updated.rows).toHaveLength(3);
    expect(updated.rows.map((r) => r.order)).toEqual([1, 2, 3]);
    expect(updated.rows[1]?.name).toBe("");
  });

  it("deletes a row and renumbers the rest", () => {
    const sheet = sheetWithRows(3);
    const targetId = sheet.rows[1]?.rowId;
    expect(targetId).toBeDefined();
    const updated = deleteRow(sheet, targetId as string);
    expect(updated.rows.map((r) => r.name)).toEqual(["R1", "R3"]);
    expect(updated.rows.map((r) => r.order)).toEqual([1, 2]);
  });

  it("moves a row up and down", () => {
    const sheet = sheetWithRows(3);
    const last = sheet.rows[2];
    expect(last).toBeDefined();
    const movedUp = moveRow(sheet, last!.rowId, "up");
    expect(movedUp.rows.map((r) => r.name)).toEqual(["R1", "R3", "R2"]);

    const first = movedUp.rows[0];
    expect(first).toBeDefined();
    const movedDown = moveRow(movedUp, first!.rowId, "down");
    expect(movedDown.rows.map((r) => r.name)).toEqual(["R3", "R1", "R2"]);
  });

  it("duplicates a row keeping address/draft/type/comment but resetting flags", () => {
    const sheet = sheetWithRows(1);
    const source = sheet.rows[0];
    expect(source).toBeDefined();
    if (source === undefined) return;
    source.name = "Speed";
    source.comment = "rpm";
    source.addressDraft = "0001";
    source.dataType = "unsigned-0.1";
    source.pollingEnabled = true;
    source.traceEnabled = true;
    source.cellText = "12.3";

    const updated = duplicateRow(sheet, source.rowId);
    expect(updated.rows).toHaveLength(2);
    const copy = updated.rows[1];
    expect(copy).toBeDefined();
    expect(copy?.name).toBe("Speed");
    expect(copy?.comment).toBe("rpm");
    expect(copy?.addressDraft).toBe("0001");
    expect(copy?.dataType).toBe("unsigned-0.1");
    expect(copy?.pollingEnabled).toBe(false);
    expect(copy?.traceEnabled).toBe(false);
    expect(copy?.rowId).not.toBe(source.rowId);
  });

  it("moveRow is a no-op at boundaries", () => {
    const sheet = sheetWithRows(2);
    const firstId = sheet.rows[0]?.rowId as string;
    expect(moveRow(sheet, firstId, "up").rows.map((r) => r.name)).toEqual([
      "R1",
      "R2",
    ]);
    const lastId = sheet.rows[1]?.rowId as string;
    expect(moveRow(sheet, lastId, "down").rows.map((r) => r.name)).toEqual([
      "R1",
      "R2",
    ]);
  });
});
