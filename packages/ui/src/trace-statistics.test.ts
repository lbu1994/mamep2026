import { describe, expect, it } from "vitest";
import type { DataType } from "@mamep2026/domain";
import { computeTraceAverage } from "./trace-statistics";

function sample(no: number, rawValue: number, dataType: DataType) {
  return { no, rawValue, dataType };
}

describe("computeTraceAverage", () => {
  it.each([
    ["hex", [0x0010, 0x0020], 24],
    ["binary", [0b0010, 0b0100], 3],
    ["unsigned", [10, 20], 15],
    ["signed", [0xffff, 0x0001], 0],
    ["unsigned-0.1", [123, 125], 12.4],
    ["signed-0.01", [0xfffe, 0x0002], 0],
  ] as const)(
    "uses Type-interpreted raw values for %s",
    (dataType, rawValues, expected) => {
      const samples = rawValues.map((rawValue, index) =>
        sample(index + 1, rawValue, dataType),
      );
      expect(computeTraceAverage(samples)?.value).toBe(expected);
    },
  );

  it("keeps the retained buffer range and count", () => {
    expect(
      computeTraceAverage([
        sample(3, 30, "unsigned"),
        sample(4, 50, "unsigned"),
      ]),
    ).toEqual({
      value: 40,
      sampleCount: 2,
      firstNo: 3,
      lastNo: 4,
    });
  });

  it("returns null when no sample has an averageable numeric type", () => {
    expect(computeTraceAverage([])).toBeNull();
    expect(computeTraceAverage([sample(1, 0x4142, "string")])).toBeNull();
    expect(computeTraceAverage([sample(1, 123, "example.numeric")])).toBeNull();
  });

  it("ignores non-numeric samples while reporting the valid range", () => {
    expect(
      computeTraceAverage([
        sample(1, 10, "unsigned"),
        sample(2, 0x4142, "string"),
        sample(3, 30, "unsigned"),
      ]),
    ).toEqual({
      value: 20,
      sampleCount: 2,
      firstNo: 1,
      lastNo: 3,
    });
  });
});
