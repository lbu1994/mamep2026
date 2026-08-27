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
    open: true,
    slaveAddress: 1,
    rows,
    registerRadix: "dec",
    columnWidths: {},
    columnOrder: null,
    writeVerify: { mode: "off", delayMs: null },
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
    expect(targets).toEqual([
      { key: on.rowId, address: 0x0001, quantity: 1 },
    ]);
  });

  it("applies the Address Adjust offset when on", () => {
    const row = makeRow(0x0003);
    row.pollingEnabled = true;
    const targets = buildPollingTargets([makeSheet("s", [row])], "on");
    expect(targets).toEqual([
      { key: row.rowId, address: 0x0002, quantity: 1 },
    ]);
  });

  it("skips address 0 rows when Address Adjust is on", () => {
    const row = makeRow(0x0000);
    row.pollingEnabled = true;
    expect(buildPollingTargets([makeSheet("s", [row])], "on")).toEqual([]);
  });
});

describe("applyPollResult", () => {
  it("formats by data type and updates registerValues", () => {
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
    expect(updated?.registerValues?.[0]?.value).toBe(0x00ab);
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

  it("returns the same row reference when the device value is unchanged (polling perf)", () => {
    const row = makeRow(0x0001, "hex");
    row.pollingEnabled = true;
    // 首轮轮询建立 registerValues 与 cellText（结果对象将写回 store）。
    const first = applyPollResult(
      [makeSheet("s", [row])],
      row.rowId,
      0x0001,
      0x00ab,
      "off",
    );
    expect(first?.cellText).toBe("00AB");
    expect(first?.registerValues?.[0]?.value).toBe(0x00ab);
    // 模拟首轮结果已写回 store：后续轮询以 first 为行对象。
    // 相同值再次轮询：返回原行引用，调用方（updateRow）据此短路，不产生状态变更。
    const second = applyPollResult(
      [makeSheet("s", [first as RegisterRow])],
      first?.rowId ?? row.rowId,
      0x0001,
      0x00ab,
      "off",
    );
    expect(second).toBe(first);
  });

  it("re-formats when the data type changed even if the value is unchanged", () => {
    const row = makeRow(0x0001, "hex");
    row.pollingEnabled = true;
    const first = applyPollResult(
      [makeSheet("s", [row])],
      row.rowId,
      0x0001,
      0x00ab,
      "off",
    );
    if (first === null) throw new Error("first poll failed");
    // 用户切换 dataType（setRowDataType 不重格式化 cellText）：cellText 仍是旧格式。
    const changed = { ...first, dataType: "unsigned" as const };
    const result = applyPollResult(
      [makeSheet("s", [changed])],
      changed.rowId,
      0x0001,
      0x00ab,
      "off",
    );
    expect(result).not.toBe(changed);
    expect(result?.cellText).toBe("171");
  });
});
