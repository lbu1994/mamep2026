import { describe, expect, it } from "vitest";
import { TraceBuffer } from "./trace-buffer";

describe("TraceBuffer", () => {
  it("wraps in chronological order and leaves previous views unchanged", () => {
    const buffer = new TraceBuffer<number>(3);
    buffer.push(1);
    const first = buffer.snapshot();
    for (let value = 2; value <= 7; value += 1) buffer.push(value);
    expect(first).toEqual([1]);
    expect(buffer.snapshot()).toEqual([5, 6, 7]);
    expect(buffer.snapshot()).toBe(buffer.snapshot());
    buffer.resize(2);
    expect(buffer.snapshot()).toEqual([6, 7]);
    buffer.resize(4);
    buffer.push(8);
    expect(buffer.snapshot()).toEqual([6, 7, 8]);
    buffer.clear();
    buffer.push(9);
    expect(buffer.snapshot()).toEqual([9]);
  });

  it("bounds Continue storage at 10000 samples", () => {
    const buffer = new TraceBuffer<number>(10000);
    for (let value = 0; value < 20001; value += 1) buffer.push(value);
    expect(buffer.length).toBe(10000);
    expect(buffer.snapshot()[0]).toBe(10001);
    expect(buffer.snapshot().at(-1)).toBe(20000);
    expect(() => buffer.resize(10001)).toThrow(RangeError);
    expect(() => new TraceBuffer(0)).toThrow(RangeError);
  });
});
