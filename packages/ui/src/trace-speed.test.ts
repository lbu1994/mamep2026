import { describe, expect, it } from "vitest";
import {
  TRACE_INTERVAL_MAX_MS,
  TRACE_INTERVAL_MIN_MS,
  traceSpeedToInterval,
} from "./trace-speed";

describe("traceSpeedToInterval", () => {
  it("maps the left Quick end to the minimum interval", () => {
    expect(traceSpeedToInterval(0)).toBe(TRACE_INTERVAL_MIN_MS);
  });

  it("maps the right Slow end to the maximum interval", () => {
    expect(traceSpeedToInterval(100)).toBe(TRACE_INTERVAL_MAX_MS);
  });

  it("maps the middle position to the midpoint interval", () => {
    expect(traceSpeedToInterval(50)).toBe(1050);
  });

  it("preserves the previous default interval at the corrected position", () => {
    expect(traceSpeedToInterval(40)).toBe(860);
  });

  it("clamps positions outside the slider range", () => {
    expect(traceSpeedToInterval(-10)).toBe(TRACE_INTERVAL_MIN_MS);
    expect(traceSpeedToInterval(110)).toBe(TRACE_INTERVAL_MAX_MS);
  });
});
