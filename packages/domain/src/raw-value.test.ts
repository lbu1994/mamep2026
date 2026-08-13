import { describe, expect, it } from "vitest";
import { RawRegisterValue } from "./raw-value";

describe("RawRegisterValue.create", () => {
  it("accepts 0 and 65535 as valid 16-bit unsigned integers", () => {
    const min = RawRegisterValue.create(0);
    const max = RawRegisterValue.create(65535);
    expect(min.ok).toBe(true);
    expect(max.ok).toBe(true);
    if (min.ok) expect(min.value.value).toBe(0);
    if (max.ok) expect(max.value.value).toBe(65535);
  });

  it("rejects values outside 0..65535 with a validation error", () => {
    for (const input of [-1, 65536, 100000]) {
      const result = RawRegisterValue.create(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("RAW_VALUE_OUT_OF_RANGE");
        expect(result.error.category).toBe("validation");
      }
    }
  });

  it("rejects non-integer numbers", () => {
    for (const input of [1.5, 0.1, Number.NaN]) {
      const result = RawRegisterValue.create(input);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects non-number inputs such as strings and null", () => {
    for (const input of ["12", null, undefined, {}]) {
      const result = RawRegisterValue.create(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("RAW_VALUE_INVALID_TYPE");
    }
  });
});
