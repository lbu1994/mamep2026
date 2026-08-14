import { describe, expect, it } from "vitest";
import { RegisterAddress, createEmptyRow } from "@mamep2026/domain";
import { commitAddress, computeSentAddress } from "./address";

describe("commitAddress (hex)", () => {
  it("commits a valid hex draft and normalizes to 4-digit uppercase", () => {
    const row = createEmptyRow();
    const result = commitAddress(row, "  ab ", "hex");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.addressValue?.value).toBe(0xab);
      expect(result.value.addressDraft).toBe("00AB");
    }
  });

  it("normalizes lowercase short hex to padded uppercase", () => {
    const row = createEmptyRow();
    const result = commitAddress(row, "1f", "hex");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.addressValue?.value).toBe(0x1f);
      expect(result.value.addressDraft).toBe("001F");
    }
  });

  it("keeps the draft and reports invalid input without clearing it", () => {
    const row = createEmptyRow();
    const result = commitAddress(row, "zzz", "hex");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("ADDRESS_INVALID_CHARACTERS");
  });

  it("rejects the 0x prefix in hex mode", () => {
    const result = commitAddress(createEmptyRow(), "0x12", "hex");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("ADDRESS_INVALID_CHARACTERS");
  });

  it("treats blank input as empty address (no request to send)", () => {
    const row = createEmptyRow();
    const result = commitAddress(row, "   ", "hex");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.addressValue).toBeNull();
  });
});

describe("commitAddress (dec)", () => {
  it("commits a valid decimal draft keeping trimmed original text", () => {
    const row = createEmptyRow();
    const result = commitAddress(row, " 31 ", "dec");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.addressValue?.value).toBe(31);
      expect(result.value.addressDraft).toBe("31");
    }
  });

  it("keeps leading zeros in dec mode (no padding applied)", () => {
    const row = createEmptyRow();
    const result = commitAddress(row, "0031", "dec");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.addressValue?.value).toBe(31);
      expect(result.value.addressDraft).toBe("0031");
    }
  });

  it("rejects hex letters in dec mode", () => {
    const result = commitAddress(createEmptyRow(), "1F", "dec");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("ADDRESS_INVALID_CHARACTERS");
  });

  it("rejects values exceeding 65535 in dec mode", () => {
    const result = commitAddress(createEmptyRow(), "70000", "dec");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ADDRESS_OUT_OF_RANGE");
  });

  it("treats blank input as empty address (no request to send)", () => {
    const result = commitAddress(createEmptyRow(), "   ", "dec");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.addressValue).toBeNull();
  });
});

describe("computeSentAddress (Address Adjust)", () => {
  it("returns the user address unchanged when Address Adjust is OFF", () => {
    const result = computeSentAddress(1, "off");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);
  });

  it("subtracts 1 when Address Adjust is ON", () => {
    const result = computeSentAddress(0x0100, "on");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x00ff);
  });

  it("rejects user address 0 with Address Adjust ON (would underflow)", () => {
    const result = computeSentAddress(0, "on");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ADDRESS_ADJUST_UNDERFLOW");
  });

  it("accepts register address 0 when Address Adjust is OFF", () => {
    const result = computeSentAddress(0, "off");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0);
  });
});

describe("RegisterAddress value consistency", () => {
  it("keeps addressValue as a controlled value object", () => {
    const address = RegisterAddress.create(0x00ff);
    expect(address.ok).toBe(true);
    if (address.ok) expect(address.value.value).toBe(0x00ff);
  });
});
