import { describe, expect, it } from "vitest";
import { createEmptyRow, createRegisterSubRowMetas } from "@mamep2026/domain";
import { commitCellText, retargetRowDataType } from "./cell-text";
import {
  commitChildCellText,
  childDataType,
  setChildMeta,
} from "./child-register";
import { applyReadValuesToRow } from "./row-operations";
import { setRegisterBit } from "./bit-register";

describe("floating-point range rows", () => {
  it("commits rounded text and raw words together and preserves them across type changes", () => {
    const row = { ...createEmptyRow(), registerCount: 2, dataType: "float32" };
    const result = commitCellText(row, "0.1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cellText).toBe("0.10000000149011612");
    expect(result.value.registerValues?.map((word) => word.value)).toEqual([
      0x3dcc, 0xcccd,
    ]);
    const hex = retargetRowDataType(result.value, "hex");
    expect(hex.cellText).toBe("3DCC CCCD");
    expect(retargetRowDataType(hex, "float32").cellText).toBe(
      result.value.cellText,
    );
    expect(retargetRowDataType(hex, "float64").cellText).toBe(hex.cellText);
    expect(childDataType(result.value, 0)).toBe("hex");
    expect(
      createRegisterSubRowMetas(2, "float32").map((meta) => meta.dataType),
    ).toEqual(["hex", "hex"]);
    expect(commitChildCellText(result.value, 0, "3F80").ok).toBe(true);
    expect(setChildMeta(result.value, 0, { dataType: "float64" }).ok).toBe(
      false,
    );
  });

  it("preserves rows when a word or bit edit would produce Infinity", () => {
    const row = { ...createEmptyRow(), registerCount: 2, dataType: "float32" };
    const finite = applyReadValuesToRow(row, [0x7f00, 0]);
    if (!finite.ok) throw new Error(finite.error.code);
    expect(commitChildCellText(finite.value, 0, "7F80").ok).toBe(false);
    expect(setRegisterBit(finite.value, 0, 7, 1).ok).toBe(false);
    expect(finite.value.registerValues?.map((word) => word.value)).toEqual([
      0x7f00, 0,
    ]);
    expect(commitCellText(finite.value, "1e999").ok).toBe(false);
  });

  it("keeps incompatible single-register type changes safe", () => {
    const row = { ...createEmptyRow(), cellText: "1234" };
    expect(retargetRowDataType(row, "float32").cellText).toBe("1234");
    expect(commitCellText({ ...row, dataType: "float64" }, "1").ok).toBe(false);
  });
});
