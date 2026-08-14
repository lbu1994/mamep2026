import { describe, expect, it } from "vitest";
import {
  RegisterAddress,
  type RegisterRow,
  type RegisterSheet,
} from "@mamep2026/domain";
import { RegisterTableService } from "./table-service";
import {
  applyPollResult,
  buildPollingTargets,
  pollResultAddressMatches,
} from "./polling";

function makeRow(
  address: number,
  dataType: RegisterRow["dataType"] = "hex",
): RegisterRow {
  const row = RegisterTableService.createRow();
  const addr = RegisterAddress.create(address);
  if (addr.ok) row.addressValue = addr.value;
  row.dataType = dataType;
  row.pollingEnabled = false;
  row.traceEnabled = false;
  row.cellText = "";
  return row;
}

function makeSheet(name: string, rows: RegisterRow[]): RegisterSheet {
  return {
    sheetId: `sheet-${name}` as never,
    name,
    type: "holding-register",
    order: 0,
    rows,
    registerRadix: "dec",
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("buildPollingTargets", () => {
  it("includes only polling-enabled rows with an address", () => {
    const on = makeRow(0x0001);
    on.pollingEnabled = true;
    const off = makeRow(0x0002);
    const noAddr = RegisterTableService.createRow();
    noAddr.pollingEnabled = true;
    const targets = buildPollingTargets(
      [makeSheet("s", [on, off, noAddr])],
      "off",
    );
    expect(targets).toEqual([{ key: on.rowId, address: 0x0001 }]);
  });

  it("applies the Address Adjust offset when on", () => {
    const row = makeRow(0x0003);
    row.pollingEnabled = true;
    const targets = buildPollingTargets([makeSheet("s", [row])], "on");
    expect(targets).toEqual([{ key: row.rowId, address: 0x0002 }]);
  });

  it("skips address 0 rows when Address Adjust is on", () => {
    const row = makeRow(0x0000);
    row.pollingEnabled = true;
    expect(buildPollingTargets([makeSheet("s", [row])], "on")).toEqual([]);
  });
});

describe("applyPollResult", () => {
  it("formats by data type and updates lastKnownRawValue", () => {
    const row = makeRow(0x0001, "hex");
    row.pollingEnabled = true;
    const updated = applyPollResult(
      [makeSheet("s", [row])],
      row.rowId,
      0x0001,
      0x00ab,
      "off",
    );
    expect(updated).not.toBeNull();
    expect(updated?.cellText).toBe("00AB");
    expect(updated?.lastKnownRawValue?.value).toBe(0x00ab);
  });

  it("returns null when the row is missing", () => {
    expect(applyPollResult([makeSheet("s", [])], "missing", 1, 1, "off")).toBe(
      null,
    );
  });

  it("returns null on a stale address (generation mismatch)", () => {
    const row = makeRow(0x0001);
    row.pollingEnabled = true;
    const result = applyPollResult(
      [makeSheet("s", [row])],
      row.rowId,
      0x0002,
      1,
      "off",
    );
    expect(result).toBeNull();
  });

  it("bypasses the generation check for batch results (address 0)", () => {
    const row = makeRow(0x0001, "unsigned");
    const result = applyPollResult(
      [makeSheet("s", [row])],
      row.rowId,
      0,
      0x0102,
      "off",
    );
    expect(result?.cellText).toBe("258");
  });

  it("validates the polling address when Address Adjust is on", () => {
    const row = makeRow(0x0003);
    row.pollingEnabled = true;
    expect(pollResultAddressMatches(row, 0x0002, "on")).toBe(true);
    expect(pollResultAddressMatches(row, 0x0003, "on")).toBe(false);
  });
});
