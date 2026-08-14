import { describe, expect, it } from "vitest";
import {
  formatRegisterAddress,
  parseRegisterAddressDraft,
} from "./address-format";

describe("formatRegisterAddress", () => {
  it("formats as 4-digit uppercase hex in hex mode", () => {
    expect(formatRegisterAddress(0, "hex")).toBe("0000");
    expect(formatRegisterAddress(1, "hex")).toBe("0001");
    expect(formatRegisterAddress(0xab, "hex")).toBe("00AB");
    expect(formatRegisterAddress(0xabcd, "hex")).toBe("ABCD");
    expect(formatRegisterAddress(65535, "hex")).toBe("FFFF");
  });

  it("formats as plain decimal in dec mode (no padding)", () => {
    expect(formatRegisterAddress(0, "dec")).toBe("0");
    expect(formatRegisterAddress(1, "dec")).toBe("1");
    expect(formatRegisterAddress(31, "dec")).toBe("31");
    expect(formatRegisterAddress(65535, "dec")).toBe("65535");
  });
});

describe("parseRegisterAddressDraft (hex)", () => {
  it("parses 1-4 digit hex, lowercase or uppercase, no 0x prefix needed", () => {
    const cases: Array<[string, number]> = [
      ["1", 1],
      ["0001", 1],
      ["abcd", 0xabcd],
      ["ABCD", 0xabcd],
      [" aBcD ", 0xabcd],
      ["ffff", 0xffff],
    ];
    for (const [input, expected] of cases) {
      const result = parseRegisterAddressDraft(input, "hex");
      expect(result.ok, `input=${input}`).toBe(true);
      if (result.ok) expect(result.value).toBe(expected);
    }
  });

  it("rejects the 0x prefix in hex mode", () => {
    for (const input of ["0x1F", "0X1f"]) {
      const result = parseRegisterAddressDraft(input, "hex");
      expect(result.ok, `input=${input}`).toBe(false);
      if (!result.ok)
        expect(result.error.code).toBe("ADDRESS_INVALID_CHARACTERS");
    }
  });

  it("returns null for blank input (no request should be sent)", () => {
    for (const input of ["", "   ", "\t"]) {
      const result = parseRegisterAddressDraft(input, "hex");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBeNull();
    }
  });

  it("rejects invalid characters without clearing user input", () => {
    for (const input of ["zz", "123g", "0x123g", "12 34", "0x 12"]) {
      const result = parseRegisterAddressDraft(input, "hex");
      expect(result.ok, `input=${input}`).toBe(false);
      if (!result.ok)
        expect(result.error.code).toBe("ADDRESS_INVALID_CHARACTERS");
    }
  });

  it("rejects more than 4 hex digits", () => {
    const result = parseRegisterAddressDraft("12345", "hex");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ADDRESS_TOO_LONG");
  });
});

describe("parseRegisterAddressDraft (dec)", () => {
  it("parses decimal digits 0..65535", () => {
    const cases: Array<[string, number]> = [
      ["0", 0],
      ["1", 1],
      ["31", 31],
      ["0031", 31],
      [" 31 ", 31],
      ["65535", 65535],
    ];
    for (const [input, expected] of cases) {
      const result = parseRegisterAddressDraft(input, "dec");
      expect(result.ok, `input=${input}`).toBe(true);
      if (result.ok) expect(result.value).toBe(expected);
    }
  });

  it("returns null for blank input (no request should be sent)", () => {
    for (const input of ["", "   ", "\t"]) {
      const result = parseRegisterAddressDraft(input, "dec");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBeNull();
    }
  });

  it("rejects non-decimal characters (hex letters included)", () => {
    for (const input of ["1F", "1f", "0x10", "12.3", "12 34", "zz"]) {
      const result = parseRegisterAddressDraft(input, "dec");
      expect(result.ok, `input=${input}`).toBe(false);
      if (!result.ok)
        expect(result.error.code).toBe("ADDRESS_INVALID_CHARACTERS");
    }
  });

  it("rejects values exceeding 65535 with ADDRESS_OUT_OF_RANGE", () => {
    for (const input of ["65536", "99999", "70000"]) {
      const result = parseRegisterAddressDraft(input, "dec");
      expect(result.ok, `input=${input}`).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ADDRESS_OUT_OF_RANGE");
    }
  });
});
