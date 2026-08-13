import { describe, expect, it } from "vitest";
import { RegisterAddress, createEmptyRow } from "@mamep2026/domain";
import { commitAddress, computeSentAddress } from "./address";

describe("commitAddress", () => {
  it("commits a valid hex draft and normalizes the value", () => {
    const row = createEmptyRow();
    row.addressDraft = "  ab ";
    const result = commitAddress(row, "  ab ");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.addressValue?.value).toBe(0xab);
      expect(result.value.addressDraft).toBe("  ab "); // 校验失败前不修改 draft
    }
  });

  it("keeps the draft and reports invalid input without clearing it", () => {
    const row = createEmptyRow();
    row.addressDraft = "zzz";
    const result = commitAddress(row, "zzz");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("ADDRESS_INVALID_CHARACTERS");
  });

  it("treats blank input as empty address (no request to send)", () => {
    const row = createEmptyRow();
    row.addressDraft = "   ";
    const result = commitAddress(row, "   ");
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
