import { describe, expect, it } from "vitest";
import { SlaveAddress } from "./slave-address";

describe("SlaveAddress.create", () => {
  it("accepts the full confirmed range 0..255", () => {
    expect(SlaveAddress.create(0).ok).toBe(true);
    expect(SlaveAddress.create(1).ok).toBe(true);
    expect(SlaveAddress.create(247).ok).toBe(true);
    expect(SlaveAddress.create(255).ok).toBe(true);
  });

  it("rejects values outside 0..255", () => {
    expect(SlaveAddress.create(-1).ok).toBe(false);
    expect(SlaveAddress.create(256).ok).toBe(false);
    expect(SlaveAddress.create(1000).ok).toBe(false);
  });

  it("rejects non-integer inputs", () => {
    expect(SlaveAddress.create(1.5).ok).toBe(false);
    expect(SlaveAddress.create("31").ok).toBe(false);
  });

  it("exposes the numeric value", () => {
    const result = SlaveAddress.create(31);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.value).toBe(31);
  });
});
