/**
 * type-split（Type 双列拆分）单测：进制/scale ↔ DataType 映射。
 */
import { describe, expect, it } from "vitest";
import {
  combineRadixScale,
  dataTypeLabelKey,
  dataTypeToRadix,
  dataTypeToScale,
  isScaleApplicable,
  RADIX_OPTIONS,
  SCALE_OPTIONS,
} from "./type-split";

describe("dataTypeToRadix", () => {
  it("maps plain radices to themselves", () => {
    expect(dataTypeToRadix("hex")).toBe("hex");
    expect(dataTypeToRadix("binary")).toBe("binary");
    expect(dataTypeToRadix("string")).toBe("string");
    expect(dataTypeToRadix("unsigned")).toBe("unsigned");
    expect(dataTypeToRadix("signed")).toBe("signed");
  });

  it("maps scaled types to their radix", () => {
    expect(dataTypeToRadix("unsigned-0.1")).toBe("unsigned");
    expect(dataTypeToRadix("unsigned-0.0001")).toBe("unsigned");
    expect(dataTypeToRadix("signed-0.01")).toBe("signed");
    expect(dataTypeToRadix("signed-0.001")).toBe("signed");
  });
});

describe("dataTypeToScale", () => {
  it("maps unscaled types to 1", () => {
    expect(dataTypeToScale("hex")).toBe("1");
    expect(dataTypeToScale("binary")).toBe("1");
    expect(dataTypeToScale("string")).toBe("1");
    expect(dataTypeToScale("unsigned")).toBe("1");
    expect(dataTypeToScale("signed")).toBe("1");
  });

  it("maps scaled types to their scale", () => {
    expect(dataTypeToScale("unsigned-0.1")).toBe("0.1");
    expect(dataTypeToScale("unsigned-0.01")).toBe("0.01");
    expect(dataTypeToScale("unsigned-0.001")).toBe("0.001");
    expect(dataTypeToScale("unsigned-0.0001")).toBe("0.0001");
    expect(dataTypeToScale("signed-0.1")).toBe("0.1");
  });
});

describe("dataTypeLabelKey", () => {
  it("maps built-in and scaled types to the localized Type label", () => {
    expect(dataTypeLabelKey("hex")).toBe("table.hex");
    expect(dataTypeLabelKey("binary")).toBe("table.binary");
    expect(dataTypeLabelKey("unsigned-0.01")).toBe("table.unsigned");
    expect(dataTypeLabelKey("signed-0.0001")).toBe("table.signed");
    expect(dataTypeLabelKey("bool")).toBe("table.bool");
  });

  it("does not mislabel plugin types as a built-in radix", () => {
    expect(dataTypeLabelKey("vendor:float32")).toBeNull();
  });
});

describe("combineRadixScale", () => {
  it("returns the radix itself for hex/binary/string", () => {
    expect(combineRadixScale("hex", "0.1")).toBe("hex");
    expect(combineRadixScale("binary", "0.01")).toBe("binary");
    expect(combineRadixScale("string", "0.001")).toBe("string");
  });

  it("combines unsigned/signed with scale", () => {
    expect(combineRadixScale("unsigned", "1")).toBe("unsigned");
    expect(combineRadixScale("unsigned", "0.1")).toBe("unsigned-0.1");
    expect(combineRadixScale("signed", "0.0001")).toBe("signed-0.0001");
    expect(combineRadixScale("signed", "1")).toBe("signed");
  });

  it("round-trips all dataTypes through radix+scale", () => {
    const all: Array<
      | "hex"
      | "unsigned"
      | "unsigned-0.1"
      | "unsigned-0.01"
      | "unsigned-0.001"
      | "unsigned-0.0001"
      | "signed"
      | "signed-0.1"
      | "signed-0.01"
      | "signed-0.001"
      | "signed-0.0001"
      | "binary"
      | "string"
    > = [
      "hex",
      "unsigned",
      "unsigned-0.1",
      "unsigned-0.01",
      "unsigned-0.001",
      "unsigned-0.0001",
      "signed",
      "signed-0.1",
      "signed-0.01",
      "signed-0.001",
      "signed-0.0001",
      "binary",
      "string",
    ];
    for (const type of all) {
      expect(
        combineRadixScale(dataTypeToRadix(type), dataTypeToScale(type)),
      ).toBe(type);
    }
  });
});

describe("isScaleApplicable", () => {
  it("only allows scale for unsigned/signed", () => {
    expect(isScaleApplicable("unsigned")).toBe(true);
    expect(isScaleApplicable("signed")).toBe(true);
    expect(isScaleApplicable("hex")).toBe(false);
    expect(isScaleApplicable("binary")).toBe(false);
    expect(isScaleApplicable("string")).toBe(false);
  });
});

describe("options", () => {
  it("contains the full radix and scale sets (bool added in ADR-043 E-2)", () => {
    expect(RADIX_OPTIONS).toEqual([
      "hex",
      "unsigned",
      "signed",
      "binary",
      "string",
      "bool",
    ]);
    expect(SCALE_OPTIONS).toEqual(["1", "0.1", "0.01", "0.001", "0.0001"]);
  });

  it("bool maps to itself with scale ignored", () => {
    expect(dataTypeToRadix("bool")).toBe("bool");
    expect(combineRadixScale("bool", "0.1")).toBe("bool");
    expect(isScaleApplicable("bool")).toBe(false);
  });
});
