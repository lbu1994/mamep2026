import { describe, expect, it } from "vitest";
import {
  RegisterAddress,
  type AddressTransformConfig,
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

function makeSheet(
  name: string,
  rows: RegisterRow[],
  options?: { addressTransform?: AddressTransformConfig | null },
): RegisterSheet {
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
    addressTransform:
      options?.addressTransform !== undefined
        ? options.addressTransform
        : null,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** 表级启用内置 Address Adjust（ADR-042）。 */
function adjustOn(): AddressTransformConfig {
  return { transformId: "builtin.address-adjust", enabled: true };
}

describe("buildPollingTargets", () => {
  it("includes only polling-enabled rows with an address", () => {
    const on = makeRow(0x0001);
    on.pollingEnabled = true;
    const off = makeRow(0x0002);
    const noAddr = RegisterTableService.createRow();
    noAddr.pollingEnabled = true;
    const targets = buildPollingTargets([makeSheet("s", [on, off, noAddr])]);
    expect(targets).toEqual([
      { key: on.rowId, address: 0x0001, quantity: 1 },
    ]);
  });

  it("applies the table Address Adjust offset when enabled", () => {
    const row = makeRow(0x0003);
    row.pollingEnabled = true;
    const targets = buildPollingTargets([
      makeSheet("s", [row], { addressTransform: adjustOn() }),
    ]);
    expect(targets).toEqual([
      { key: row.rowId, address: 0x0002, quantity: 1 },
    ]);
  });

  it("skips address 0 rows when table Address Adjust is enabled", () => {
    const row = makeRow(0x0000);
    row.pollingEnabled = true;
    expect(
      buildPollingTargets([
        makeSheet("s", [row], { addressTransform: adjustOn() }),
      ]),
    ).toEqual([]);
  });

  it("applies per-sheet transform independently (ADR-042 非活动表轮询按各自 sheet)", () => {
    const onRow = makeRow(0x0003);
    onRow.pollingEnabled = true;
    const offRow = makeRow(0x0005);
    offRow.pollingEnabled = true;
    const targets = buildPollingTargets([
      makeSheet("a", [onRow], { addressTransform: adjustOn() }),
      makeSheet("b", [offRow]),
    ]);
    expect(targets).toEqual([
      { key: onRow.rowId, address: 0x0002, quantity: 1 },
      { key: offRow.rowId, address: 0x0005, quantity: 1 },
    ]);
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
    );
    expect(updated).not.toBeNull();
    expect(updated?.cellText).toBe("00AB");
    expect(updated?.registerValues?.[0]?.value).toBe(0x00ab);
  });

  it("returns null when the row is missing", () => {
    expect(applyPollResult([makeSheet("s", [])], "missing", 1, 1)).toBe(null);
  });

  it("returns null on a stale address (generation mismatch)", () => {
    const row = makeRow(0x0001);
    row.pollingEnabled = true;
    const result = applyPollResult(
      [makeSheet("s", [row])],
      row.rowId,
      0x0002,
      1,
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
    );
    expect(result?.cellText).toBe("258");
  });

  it("validates the polling address when the table Address Adjust is enabled", () => {
    const row = makeRow(0x0003);
    row.pollingEnabled = true;
    const sheet = makeSheet("s", [row], { addressTransform: adjustOn() });
    expect(pollResultAddressMatches(row, sheet, 0x0002)).toBe(true);
    expect(pollResultAddressMatches(row, sheet, 0x0003)).toBe(false);
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
    );
    if (first === null) throw new Error("first poll failed");
    // 用户切换 dataType（setRowDataType 不重格式化 cellText）：cellText 仍是旧格式。
    const changed = { ...first, dataType: "unsigned" as const };
    const result = applyPollResult(
      [makeSheet("s", [changed])],
      changed.rowId,
      0x0001,
      0x00ab,
    );
    expect(result).not.toBe(changed);
    expect(result?.cellText).toBe("171");
  });
});
