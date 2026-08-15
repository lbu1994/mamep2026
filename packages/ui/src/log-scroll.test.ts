import { describe, expect, it } from "vitest";
import { isNearBottom } from "./log-scroll";

describe("isNearBottom", () => {
  it("returns true when scrolled exactly to the bottom", () => {
    expect(isNearBottom(100, 80, 20)).toBe(true);
  });

  it("returns true when within a few pixels of the bottom", () => {
    expect(isNearBottom(100, 79, 20)).toBe(true);
    expect(isNearBottom(100, 65, 20)).toBe(true);
  });

  it("returns true at the exact threshold boundary", () => {
    expect(isNearBottom(100, 64, 20, 16)).toBe(true);
  });

  it("returns false when scrolled further than the threshold", () => {
    expect(isNearBottom(100, 63, 20)).toBe(false);
    expect(isNearBottom(100, 0, 20)).toBe(false);
  });

  it("returns true when content does not overflow the container", () => {
    expect(isNearBottom(100, 0, 120)).toBe(true);
  });

  it("honors a custom threshold", () => {
    expect(isNearBottom(100, 65, 20, 8)).toBe(false);
    expect(isNearBottom(100, 85, 20, 8)).toBe(true);
  });
});
