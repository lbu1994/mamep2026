import { describe, expect, it } from "vitest";
import {
  formatRegisterAddress,
  parseRegisterAddressDraft,
} from "./address-format";

describe("formatRegisterAddress", () => {
  it("formats as 4-digit uppercase hex", () => {
    expect(formatRegisterAddress(0)).toBe("0000");
    expect(formatRegisterAddress(1)).toBe("0001");
    expect(formatRegisterAddress(0xab)).toBe("00AB");
    expect(formatRegisterAddress(0xabcd)).toBe("ABCD");
    expect(formatRegisterAddress(65535)).toBe("FFFF");
  });
});

describe("parseRegisterAddressDraft", () => {
  it("parses 1-4 digit hex, lowercase or uppercase, with optional 0x prefix", () => {
    const cases: Array<[string, number]> = [
      ["1", 1],
      ["0001", 1],
      ["abcd", 0xabcd],
      ["ABCD", 0xabcd],
      [" aBcD ", 0xabcd],
      ["0x1F", 0x1f],
      ["0X1f", 0x1f],
      ["ffff", 0xffff],
    ];
    for (const [input, expected] of cases) {
      const result = parseRegisterAddressDraft(input);
      expect(result.ok, `input=${input}`).toBe(true);
      if (result.ok) expect(result.value).toBe(expected);
    }
  });

  it("returns null for blank input (no request should be sent)", () => {
    for (const input of ["", "   ", "\t"]) {
      const result = parseRegisterAddressDraft(input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBeNull();
    }
  });

  it("rejects invalid characters without clearing user input", () => {
    for (const input of ["zz", "123g", "0x123g", "12 34", "0x 12"]) {
      const result = parseRegisterAddressDraft(input);
      expect(result.ok, `input=${input}`).toBe(false);
      if (!result.ok)
        expect(result.error.code).toBe("ADDRESS_INVALID_CHARACTERS");
    }
  });

  it("rejects more than 4 hex digits", () => {
    const result = parseRegisterAddressDraft("12345");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ADDRESS_TOO_LONG");
  });
});
