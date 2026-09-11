import { describe, expect, it } from "vitest";
import {
  RawRegisterValue,
  RegisterAddress,
  createEmptyRow,
  createMamepError,
  fail,
  ok,
} from "@mamep2026/domain";
import {
  applyAddressTransform,
  commitAddress,
  isRowTypeCountValid,
  resolveSheetAddressTransform,
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
  it("commits a valid decimal draft and normalizes to plain decimal", () => {
    const row = createEmptyRow();
    const result = commitAddress(row, " 31 ", "dec");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.addressValue?.value).toBe(31);
      expect(result.value.addressDraft).toBe("31");
    }
  });

  it("normalizes away leading zeros in dec mode（ADR-051）", () => {
    const row = createEmptyRow();
    const result = commitAddress(row, "0031", "dec");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.addressValue?.value).toBe(31);
      expect(result.value.addressDraft).toBe("31");
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
    if (result.ok) {
      expect(result.value.addressValue).toBeNull();
      // 空输入归一为 ""（ADR-051）。
      expect(result.value.addressDraft).toBe("");
    }
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
    expect(
      result.value.registers?.every((m) => m.dataType === "unsigned"),
    ).toBe(true);
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

  it("位注释与位名称随范围长度保留/截断（ADR-052）", () => {
    const slots = (label: string) =>
      Array.from({ length: 16 }, (_, index) => (index === 0 ? label : ""));
    const row = {
      ...createEmptyRow(),
      registerCount: 2,
      bitComments: [slots("a"), slots("b")],
      bitNames: [slots("na"), slots("nb")],
    };
    // 扩大：按寄存器序号保留前两项，其余补 null。
    const wider = commitAddress(row, "1000-1003", "dec");
    expect(wider.ok).toBe(true);
    if (!wider.ok) return;
    expect(wider.value.bitComments).toHaveLength(4);
    expect(wider.value.bitComments?.[0]?.[0]).toBe("a");
    expect(wider.value.bitComments?.[1]?.[0]).toBe("b");
    expect(wider.value.bitComments?.[2]).toBeNull();
    expect(wider.value.bitNames).toHaveLength(4);
    expect(wider.value.bitNames?.[0]?.[0]).toBe("na");
    expect(wider.value.bitNames?.[1]?.[0]).toBe("nb");
    expect(wider.value.bitNames?.[2]).toBeNull();
    // 缩小到单寄存器行：仅保留第 1 个寄存器的位注释/位名称（单寄存器行外层长度 1）。
    const narrowed = commitAddress(row, "1000", "dec");
    expect(narrowed.ok).toBe(true);
    if (!narrowed.ok) return;
    expect(narrowed.value.registerCount).toBe(1);
    expect(narrowed.value.bitComments).toHaveLength(1);
    expect(narrowed.value.bitComments?.[0]?.[0]).toBe("a");
    expect(narrowed.value.bitNames).toHaveLength(1);
    expect(narrowed.value.bitNames?.[0]?.[0]).toBe("na");
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
    expect(isRowTypeCountValid({ dataType: "binary", registerCount: 3 })).toBe(
      true,
    );
    expect(isRowTypeCountValid({ dataType: "binary", registerCount: 5 })).toBe(
      false,
    );
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

describe("applyAddressTransform / resolveSheetAddressTransform（ADR-042 表级地址变换；2026-09-02 插件外部化）", () => {
  it("null transform leaves the address unchanged", () => {
    const result = applyAddressTransform(0x0100, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x0100);
  });

  it("applies an injected transform（用户地址 − 1）", () => {
    const minusOne = {
      id: "builtin.address-adjust",
      protocol: "rtu",
      apply: (v: number) => ok(v - 1),
      validate: () => ok(null),
    };
    const result = applyAddressTransform(0x0100, minusOne);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x00ff);
  });

  it("transform reject user address 0（下溢 → 结构化错误）", () => {
    const minusOne = {
      id: "builtin.address-adjust",
      protocol: "rtu",
      apply: (v: number) =>
        v === 0
          ? fail(
              createMamepError({
                code: "ADDRESS_ADJUST_UNDERFLOW",
                category: "validation",
                userMessageKey: "errors.addressAdjustUnderflow",
                technicalMessage: "address 0 cannot be adjusted by -1",
              }),
            )
          : ok(v - 1),
      validate: () => ok(null),
    };
    const result = applyAddressTransform(0, minusOne);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ADDRESS_ADJUST_UNDERFLOW");
  });

  it("resolveSheetAddressTransform：未配置/关闭 → null；启用经注入 resolver 解析", () => {
    expect(resolveSheetAddressTransform(null)).toBeNull();
    expect(
      resolveSheetAddressTransform({
        transformId: "builtin.address-adjust",
        enabled: false,
      }),
    ).toBeNull();
    const enabled = resolveSheetAddressTransform(
      {
        transformId: "builtin.address-adjust",
        enabled: true,
      },
      (id) =>
        id === "builtin.address-adjust"
          ? {
              id,
              protocol: "rtu",
              apply: (v: number) => ok(v - 1),
              validate: () => ok(null),
            }
          : null,
    );
    expect(enabled).not.toBeNull();
    expect(enabled?.apply(5)).toEqual(ok(4));
  });

  it("resolveSheetAddressTransform：缺省 resolver 不解析任何 id（核心不再内置变换）", () => {
    expect(
      resolveSheetAddressTransform({
        transformId: "builtin.address-adjust",
        enabled: true,
      }),
    ).toBeNull();
  });

  it("resolveSheetAddressTransform：未知 id 启用时回退 null（自定义变换由宿主注入）", () => {
    expect(
      resolveSheetAddressTransform(
        { transformId: "missing", enabled: true },
        () => null,
      ),
    ).toBeNull();
  });
});

describe("RegisterAddress value consistency", () => {
  it("keeps addressValue as a controlled value object", () => {
    const address = RegisterAddress.create(0x00ff);
    expect(address.ok).toBe(true);
    if (address.ok) expect(address.value.value).toBe(0x00ff);
  });
});
