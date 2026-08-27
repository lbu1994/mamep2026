import { describe, expect, it } from "vitest";
import {
  RawRegisterValue,
  RegisterAddress,
  createEmptyRow,
} from "@mamep2026/domain";
import {
  commitAddress,
  computeSentAddress,
  isRowTypeCountValid,
  rowTypeCountError,
} from "./address";

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

describe("commitAddress 范围行（ADR-030）", () => {
  it("commits a hex range and sets registerCount", () => {
    const row = createEmptyRow();
    const result = commitAddress(row, "0400-0401", "hex");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.addressValue?.value).toBe(0x400);
      expect(result.value.registerCount).toBe(2);
      expect(result.value.addressDraft).toBe("0400-0401");
    }
  });

  it("commits a dec range", () => {
    const row = createEmptyRow();
    const result = commitAddress(row, "1000-1002", "dec");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.addressValue?.value).toBe(1000);
      expect(result.value.registerCount).toBe(3);
      expect(result.value.addressDraft).toBe("1000-1002");
    }
  });

  it("resets registerCount to 1 when the address is cleared", () => {
    const row = { ...createEmptyRow(), registerCount: 2 };
    const result = commitAddress(row, "   ", "hex");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.addressValue).toBeNull();
      expect(result.value.registerCount).toBe(1);
    }
  });

  it("clears registerValues when the range count changes", () => {
    const address = RegisterAddress.create(0x400);
    const raw = RawRegisterValue.create(0x1234);
    const row = {
      ...createEmptyRow(),
      addressValue: address.ok ? address.value : null,
      registerCount: 2,
      registerValues: raw.ok ? [raw.value] : null,
    };
    const result = commitAddress(row, "0400-0403", "hex");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.registerCount).toBe(4);
      expect(result.value.registerValues).toBeNull();
    }
  });

  it("范围提交时按父行 dataType 初始化子行元数据数组（2026-08-27）", () => {
    const row = { ...createEmptyRow(), dataType: "unsigned" as const };
    const result = commitAddress(row, "1000-1001", "dec");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registers).toHaveLength(2);
    expect(result.value.registers?.every((m) => m.dataType === "unsigned")).toBe(
      true,
    );
    expect(result.value.registers?.every((m) => m.name === "")).toBe(true);
  });

  it("范围扩大时子行元数据按索引保留并补齐默认（2026-08-27）", () => {
    const row = {
      ...createEmptyRow(),
      dataType: "hex" as const,
      registerCount: 2,
      registers: [
        { name: "Hi", comment: "h", dataType: "unsigned" as const },
        { name: "Lo", comment: "", dataType: "hex" as const },
      ],
    };
    const result = commitAddress(row, "1000-1003", "dec");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registers).toHaveLength(4);
    expect(result.value.registers?.[0]).toEqual({
      name: "Hi",
      comment: "h",
      dataType: "unsigned",
    });
    expect(result.value.registers?.[2]).toEqual({
      name: "",
      comment: "",
      dataType: "hex",
    });
    // 值仍按范围变化清空。
    expect(result.value.registerValues).toBeNull();
  });

  it("范围缩小时子行元数据按索引截断（2026-08-27）", () => {
    const row = {
      ...createEmptyRow(),
      registerCount: 3,
      registers: [
        { name: "a", comment: "", dataType: "hex" as const },
        { name: "b", comment: "", dataType: "hex" as const },
        { name: "c", comment: "", dataType: "hex" as const },
      ],
    };
    const result = commitAddress(row, "1000-1001", "dec");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registers).toHaveLength(2);
    expect(result.value.registers?.map((m) => m.name)).toEqual(["a", "b"]);
  });

  it("范围长度不变时子行元数据原引用保留（2026-08-27）", () => {
    const row = {
      ...createEmptyRow(),
      registerCount: 2,
      registers: [
        { name: "a", comment: "", dataType: "hex" as const },
        { name: "b", comment: "", dataType: "hex" as const },
      ],
    };
    const result = commitAddress(row, "1000-1001", "dec");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registers).toBe(row.registers);
    // 单值范围变单寄存器行：registers 清空。
    const single = commitAddress(row, "1000", "dec");
    expect(single.ok).toBe(true);
    if (!single.ok) return;
    expect(single.value.registerCount).toBe(1);
    expect(single.value.registers).toBeNull();
  });

  it("rejects reversed range", () => {
    const result = commitAddress(createEmptyRow(), "0402-0400", "hex");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ADDRESS_RANGE_REVERSED");
  });
});

describe("isRowTypeCountValid / rowTypeCountError（ADR-030）", () => {
  it("allows decimal 1/2/4 and binary 1/2/3/4", () => {
    expect(
      isRowTypeCountValid({ dataType: "unsigned", registerCount: 2 }),
    ).toBe(true);
    expect(
      isRowTypeCountValid({ dataType: "unsigned", registerCount: 3 }),
    ).toBe(false);
    expect(
      isRowTypeCountValid({ dataType: "binary", registerCount: 3 }),
    ).toBe(true);
    expect(
      isRowTypeCountValid({ dataType: "binary", registerCount: 5 }),
    ).toBe(false);
  });

  it("allows any count for hex and string", () => {
    expect(isRowTypeCountValid({ dataType: "hex", registerCount: 7 })).toBe(
      true,
    );
    expect(isRowTypeCountValid({ dataType: "string", registerCount: 10 })).toBe(
      true,
    );
  });

  it("returns a type-column error with message key when invalid", () => {
    const error = rowTypeCountError({ dataType: "unsigned", registerCount: 3 });
    expect(error).toEqual({
      messageKey: "errors.dataInvalidRegisterCount",
      detail: "DATA_INVALID_REGISTER_COUNT",
    });
    expect(
      rowTypeCountError({ dataType: "unsigned", registerCount: 2 }),
    ).toBeNull();
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
