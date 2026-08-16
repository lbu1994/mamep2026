import { describe, expect, it } from "vitest";
import {
  createRegisterSheet,
  createEmptyRow,
  type RegisterSheet,
} from "@mamep2026/domain";
import {
  addRowAfter,
  deleteRow,
  deleteRows,
  duplicateRow,
  insertRowBefore,
  moveRow,
  moveRowToIndex,
  moveRows,
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

describe("insertRowBefore", () => {
  it("inserts an empty row before the target row and renumbers", () => {
    const sheet = sheetWithRows(3);
    const target = sheet.rows[1];
    expect(target).toBeDefined();
    const updated = insertRowBefore(sheet, (target as { rowId: string }).rowId);
    expect(updated.rows.map((r) => r.name)).toEqual(["R1", "", "R2", "R3"]);
    expect(updated.rows.map((r) => r.order)).toEqual([1, 2, 3, 4]);
  });

  it("inserts before the first row", () => {
    const sheet = sheetWithRows(1);
    const target = sheet.rows[0];
    expect(target).toBeDefined();
    const updated = insertRowBefore(sheet, (target as { rowId: string }).rowId);
    expect(updated.rows.map((r) => r.name)).toEqual(["", "R1"]);
    expect(updated.rows[0]?.order).toBe(1);
  });

  it("appends at the end when the target row is missing", () => {
    const sheet = sheetWithRows(1);
    const updated = insertRowBefore(sheet, "missing");
    expect(updated.rows).toHaveLength(2);
    expect(updated.rows[1]?.name).toBe("");
  });
});

describe("moveRowToIndex", () => {
  it("moves a row down to a lower index (arrayMove semantics)", () => {
    const sheet = sheetWithRows(4);
    const first = sheet.rows[0];
    expect(first).toBeDefined();
    // 语义同 dnd-kit arrayMove：先移除再插入到目标索引。
    const updated = moveRowToIndex(
      sheet,
      (first as { rowId: string }).rowId,
      2,
    );
    expect(updated.rows.map((r) => r.name)).toEqual(["R2", "R3", "R1", "R4"]);
    expect(updated.rows.map((r) => r.order)).toEqual([1, 2, 3, 4]);
  });

  it("moves a row up to a higher index (arrayMove semantics)", () => {
    const sheet = sheetWithRows(4);
    const last = sheet.rows[3];
    expect(last).toBeDefined();
    const updated = moveRowToIndex(sheet, (last as { rowId: string }).rowId, 0);
    expect(updated.rows.map((r) => r.name)).toEqual(["R4", "R1", "R2", "R3"]);
  });

  it("moves a row to the adjacent position", () => {
    const sheet = sheetWithRows(3);
    const first = sheet.rows[0];
    expect(first).toBeDefined();
    const updated = moveRowToIndex(
      sheet,
      (first as { rowId: string }).rowId,
      1,
    );
    expect(updated.rows.map((r) => r.name)).toEqual(["R2", "R1", "R3"]);
  });

  it("clamps an out-of-range target index to the last position", () => {
    const sheet = sheetWithRows(3);
    const first = sheet.rows[0];
    expect(first).toBeDefined();
    const updated = moveRowToIndex(
      sheet,
      (first as { rowId: string }).rowId,
      100,
    );
    expect(updated.rows.map((r) => r.name)).toEqual(["R2", "R3", "R1"]);
  });

  it("clamps a negative target index to the first position", () => {
    const sheet = sheetWithRows(3);
    const last = sheet.rows[2];
    expect(last).toBeDefined();
    const updated = moveRowToIndex(
      sheet,
      (last as { rowId: string }).rowId,
      -5,
    );
    expect(updated.rows.map((r) => r.name)).toEqual(["R3", "R1", "R2"]);
  });

  it("is a no-op when the target index equals the current index", () => {
    const sheet = sheetWithRows(3);
    const second = sheet.rows[1];
    expect(second).toBeDefined();
    const updated = moveRowToIndex(
      sheet,
      (second as { rowId: string }).rowId,
      1,
    );
    expect(updated.rows.map((r) => r.name)).toEqual(["R1", "R2", "R3"]);
    expect(updated).toBe(sheet);
  });

  it("is a no-op when the row id is missing", () => {
    const sheet = sheetWithRows(3);
    const updated = moveRowToIndex(sheet, "missing", 0);
    expect(updated.rows.map((r) => r.name)).toEqual(["R1", "R2", "R3"]);
    expect(updated).toBe(sheet);
  });

  it("renumbers rows after moving", () => {
    const sheet = sheetWithRows(5);
    const first = sheet.rows[0];
    expect(first).toBeDefined();
    const updated = moveRowToIndex(
      sheet,
      (first as { rowId: string }).rowId,
      3,
    );
    expect(updated.rows.map((r) => r.order)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("moveRows", () => {
  it("moves a contiguous selected block up by one position", () => {
    const sheet = sheetWithRows(4);
    const targetIds = [sheet.rows[1], sheet.rows[2]].map(
      (r) => r?.rowId as string,
    );
    const updated = moveRows(sheet, targetIds, "up");
    expect(updated.rows.map((r) => r.name)).toEqual(["R2", "R3", "R1", "R4"]);
  });

  it("moves a contiguous selected block down by one position", () => {
    const sheet = sheetWithRows(4);
    const targetIds = [sheet.rows[1], sheet.rows[2]].map(
      (r) => r?.rowId as string,
    );
    const updated = moveRows(sheet, targetIds, "down");
    expect(updated.rows.map((r) => r.name)).toEqual(["R1", "R4", "R2", "R3"]);
  });

  it("moves non-contiguous selected rows up while keeping their relative order", () => {
    const sheet = sheetWithRows(4);
    const targetIds = [sheet.rows[1], sheet.rows[3]].map(
      (r) => r?.rowId as string,
    );
    const updated = moveRows(sheet, targetIds, "up");
    expect(updated.rows.map((r) => r.name)).toEqual(["R2", "R1", "R4", "R3"]);
  });

  it("is a no-op at boundaries and when all rows are selected", () => {
    const sheet = sheetWithRows(3);
    const first = sheet.rows[0];
    expect(first).toBeDefined();
    const upNoop = moveRows(sheet, [(first as { rowId: string }).rowId], "up");
    expect(upNoop.rows.map((r) => r.name)).toEqual(["R1", "R2", "R3"]);
    const allSelected = moveRows(
      sheet,
      sheet.rows.map((r) => r.rowId),
      "up",
    );
    expect(allSelected.rows.map((r) => r.name)).toEqual(["R1", "R2", "R3"]);
  });

  it("renumbers after moving", () => {
    const sheet = sheetWithRows(3);
    const targetId = sheet.rows[2]?.rowId as string;
    const updated = moveRows(sheet, [targetId], "up");
    expect(updated.rows.map((r) => r.order)).toEqual([1, 2, 3]);
  });
});

describe("deleteRows", () => {
  it("removes multiple rows and renumbers the rest", () => {
    const sheet = sheetWithRows(4);
    const targetIds = [sheet.rows[0], sheet.rows[2]].map(
      (r) => r?.rowId as string,
    );
    const updated = deleteRows(sheet, targetIds);
    expect(updated.rows.map((r) => r.name)).toEqual(["R2", "R4"]);
    expect(updated.rows.map((r) => r.order)).toEqual([1, 2]);
  });

  it("removes all rows when every row is selected", () => {
    const sheet = sheetWithRows(2);
    const updated = deleteRows(
      sheet,
      sheet.rows.map((r) => r.rowId),
    );
    expect(updated.rows).toHaveLength(0);
  });
});
