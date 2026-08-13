import { describe, expect, it } from "vitest";
import { RegisterAddress } from "./register-address";

describe("RegisterAddress.create", () => {
  it("accepts 0 and 65535 as valid addresses", () => {
    expect(RegisterAddress.create(0).ok).toBe(true);
    expect(RegisterAddress.create(65535).ok).toBe(true);
  });

  it("rejects negative and oversized addresses", () => {
    expect(RegisterAddress.create(-1).ok).toBe(false);
    expect(RegisterAddress.create(65536).ok).toBe(false);
  });

  it("rejects non-integer and non-number inputs", () => {
    expect(RegisterAddress.create(1.5).ok).toBe(false);
    expect(RegisterAddress.create("1").ok).toBe(false);
    expect(RegisterAddress.create(undefined).ok).toBe(false);
  });
});
