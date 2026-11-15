/**
 * Data 单元格提交用例测试（TDD，docs/AGENTS.md §17/§23）。
 * 对称于 address.ts 的 commitAddress：校验失败返回结构化错误、保留输入（由调用方回写）；
 * 成功提交写回规范显示文本（与设备读回后格式化同源）。
 */
import { describe, expect, it } from "vitest";
import { createEmptyRow, type DataType } from "@mamep2026/domain";
import { createDataTypeResolver } from "@mamep2026/data-conversion";
import {
  canonicalCellText,
  commitCellText,
  retargetRowDataType,
} from "./cell-text";

function makeRow(dataType: DataType) {
  return { ...createEmptyRow(), dataType, cellText: "" };
}

function makeRowWithCount(dataType: DataType, registerCount: number) {
  return { ...createEmptyRow(), dataType, registerCount, cellText: "" };
}

describe("commitCellText", () => {
  it("提交合法值：更新 cellText 并返回新行（不改原行）", () => {
    const row = makeRow("unsigned");
    const result = commitCellText(row, "42");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cellText).toBe("42");
      expect(result.value).not.toBe(row);
      expect(row.cellText).toBe("");
    }
  });

  it("成功提交写回规范显示文本（ADR-051：去空格、去 0x 前缀、补零大写）", () => {
    const row = makeRow("hex");
    const result = commitCellText(row, " ab ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.cellText).toBe("00AB");
  });

  it("非法值：返回结构化错误（DATA_INVALID_NUMBER），行不变", () => {
    const row = makeRow("unsigned");
    const result = commitCellText(row, "zz");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DATA_INVALID_NUMBER");
      expect(result.error.category).toBe("validation");
    }
    expect(row.cellText).toBe("");
  });

  it("空输入：返回 DATA_EMPTY", () => {
    const row = makeRow("hex");
    const result = commitCellText(row, "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATA_EMPTY");
  });

  it("超范围：返回 DATA_OUT_OF_RANGE（signed 上界）", () => {
    const row = makeRow("signed");
    const result = commitCellText(row, "32768");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATA_OUT_OF_RANGE");
  });

  it("小数位超精度：返回 DATA_TOO_MANY_DECIMALS", () => {
    const row = makeRow("unsigned-0.1");
    const result = commitCellText(row, "12.34");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATA_TOO_MANY_DECIMALS");
  });

  it("ADR-043 E-3：插件类型经 resolver 解析（缺省仅内置时失败）", () => {
    const row = makeRow("my-plugin:speed" as DataType);
    // 无 resolver：DATA_UNSUPPORTED_TYPE。
    const without = commitCellText(row, "1500");
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.error.code).toBe("DATA_UNSUPPORTED_TYPE");

    // 注入 resolver（注册插件处理函数）后成功。
    const resolver = createDataTypeResolver();
    resolver.register("my-plugin:speed", {
      parse: (text) =>
        ({ ok: true as const, value: Number(text) || 0 }) as const,
      format: (raw) => `${raw} rpm`,
    });
    const withResolver = commitCellText(row, "1500", resolver);
    expect(withResolver.ok).toBe(true);
    if (withResolver.ok) expect(withResolver.value.cellText).toBe("1500 rpm");
  });
});

describe("commitCellText 同步 registerValues（2026-09-11 bug 修复）", () => {
  /** 范围行（已读取 hex 1234 ABCD）。 */
  function readRangeRow() {
    return {
      ...createEmptyRow(),
      dataType: "hex" as DataType,
      registerCount: 2,
      cellText: "1234 ABCD",
      registerValues: [{ value: 0x1234 }, { value: 0xabcd }],
    };
  }

  it("范围行父行提交：按父行 dataType 解析并回写 registerValues（子行/位明细数据源）", () => {
    const result = commitCellText(readRangeRow(), "ffff 0000");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cellText).toBe("FFFF 0000");
    expect(result.value.registerValues?.map((v) => v.value)).toEqual([
      0xffff, 0x0000,
    ]);
  });

  it("单寄存器 binary 行提交：同步 registerValues（位明细数据源）", () => {
    const row = {
      ...createEmptyRow(),
      dataType: "binary" as DataType,
      cellText: "00000000 10101011",
      registerValues: [{ value: 0x00ab }],
    };
    const result = commitCellText(row, "11111111 11111111");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.registerValues?.[0]?.value).toBe(0xffff);
  });

  it("尚未读取（registerValues=null）提交：按输入派生原始值", () => {
    const result = commitCellText(makeRow("unsigned"), "42");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.registerValues?.[0]?.value).toBe(42);
  });

  it("校验失败：行不变（保留旧 registerValues）", () => {
    const row = {
      ...createEmptyRow(),
      dataType: "unsigned" as DataType,
      cellText: "1",
      registerValues: [{ value: 1 }],
    };
    const result = commitCellText(row, "zz");
    expect(result.ok).toBe(false);
    expect(row.registerValues?.map((v) => v.value)).toEqual([1]);
  });

  it("空文本：返回 DATA_EMPTY，不改 registerValues", () => {
    const row = readRangeRow();
    const result = commitCellText(row, "   ");
    expect(result.ok).toBe(false);
    expect(row.registerValues?.map((v) => v.value)).toEqual([0x1234, 0xabcd]);
  });
});

describe("canonicalCellText（ADR-051：提交/粘贴后规范化）", () => {
  const singleCases: Array<[DataType, string, string]> = [
    ["hex", " ab ", "00AB"],
    ["hex", "0xAB", "00AB"],
    ["hex", "1f", "001F"],
    ["unsigned", "0005", "5"],
    ["unsigned", "+7", "7"],
    ["signed", "+5", "5"],
    ["signed", "-1", "-1"],
    ["unsigned-0.1", "12", "12.0"],
    ["unsigned-0.1", "0", "0.0"],
    ["signed-0.01", "-0.5", "-0.50"],
    ["binary", "101", "00000000 00000101"],
    ["binary", "00000000 00000101", "00000000 00000101"],
    ["bool", "1", "1"],
    ["string", "A", "A "],
    ["string", "AB", "AB"],
  ];
  it.each(singleCases)("单寄存器 %s：%s → %s", (type, input, expected) => {
    const result = canonicalCellText(makeRow(type), input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(expected);
  });

  const compositeCases: Array<[DataType, number, string, string]> = [
    ["hex", 2, "1234abcd", "1234 ABCD"],
    ["binary", 2, "1", "00000000 00000000 00000000 00000001"],
    ["unsigned", 2, "00065538", "65538"],
    ["unsigned-0.1", 2, "1.0", "1.0"],
    ["string", 2, "AB", "AB  "],
  ];
  it.each(compositeCases)(
    "范围行 %s×%i：%s → %s",
    (type, count, input, expected) => {
      const result = canonicalCellText(makeRowWithCount(type, count), input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(expected);
    },
  );

  it("解析失败返回结构化错误（调用方保留用户输入）", () => {
    const result = canonicalCellText(makeRow("unsigned"), "zz");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATA_INVALID_NUMBER");
  });

  it("插件类型经 resolver 格式化", () => {
    const resolver = createDataTypeResolver();
    resolver.register("my-plugin:speed", {
      parse: (text) =>
        ({ ok: true as const, value: Number(text) || 0 }) as const,
      format: (raw) => `${raw} rpm`,
    });
    const result = canonicalCellText(
      makeRow("my-plugin:speed" as DataType),
      "1500",
      resolver,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("1500 rpm");
  });
});

describe("retargetRowDataType（ADR-053：Type/Scale 切换即时刷新显示）", () => {
  /** 构造带当前值文本的行（模拟读取后/编辑后的状态）。 */
  function rowWith(
    dataType: DataType,
    cellText: string,
    registerCount = 1,
  ): ReturnType<typeof createEmptyRow> {
    return {
      ...createEmptyRow(),
      dataType,
      registerCount,
      cellText,
      registerValues: [{ value: 0x00ab }],
    };
  }

  const singleCases: Array<[DataType, string, DataType, string]> = [
    // 读回 HEX 00AB → 各进制显示同一数值。
    ["hex", "00AB", "unsigned", "171"],
    ["hex", "00AB", "binary", "00000000 10101011"],
    ["hex", "FFFF", "signed", "-1"],
    ["hex", "4142", "string", "AB"],
    ["hex", "0001", "bool", "1"],
    // **关键**：不得按新进制重解释当前文本（171 作为 hex 解析会变成 0x171 = 369）。
    ["unsigned", "171", "hex", "00AB"],
    ["unsigned", "171", "binary", "00000000 10101011"],
    ["unsigned-0.1", "17.1", "unsigned", "171"],
    ["unsigned", "171", "unsigned-0.1", "17.1"],
    ["signed", "-1", "hex", "FFFF"],
    ["binary", "00000000 10101011", "unsigned", "171"],
    ["string", "AB", "hex", "4142"],
    ["bool", "1", "unsigned", "1"],
  ];
  it.each(singleCases)(
    "单寄存器 %s「%s」→ %s「%s」",
    (fromType, text, toType, expected) => {
      const next = retargetRowDataType(rowWith(fromType, text), toType);
      expect(next.dataType).toBe(toType);
      expect(next.cellText).toBe(expected);
    },
  );

  it("不改原始值（registerValues 保持原引用）与入参行", () => {
    const row = rowWith("hex", "00AB");
    const next = retargetRowDataType(row, "unsigned");
    expect(row.dataType).toBe("hex");
    expect(row.cellText).toBe("00AB");
    expect(next.registerValues).toBe(row.registerValues);
    expect(next).not.toBe(row);
  });

  it("类型未变化：原引用返回（零更新短路）", () => {
    const row = rowWith("hex", "00AB");
    expect(retargetRowDataType(row, "hex")).toBe(row);
  });

  it("空文本：仅切换类型，保持空（不生成 0）", () => {
    const next = retargetRowDataType(rowWith("hex", ""), "unsigned");
    expect(next.dataType).toBe("unsigned");
    expect(next.cellText).toBe("");
    const blank = retargetRowDataType(rowWith("hex", "   "), "unsigned");
    expect(blank.cellText).toBe("   ");
  });

  it("旧文本解析失败：保留原文（§23），仅切换类型", () => {
    const next = retargetRowDataType(rowWith("unsigned", "zz"), "hex");
    expect(next.dataType).toBe("hex");
    expect(next.cellText).toBe("zz");
  });

  const compositeCases: Array<[DataType, number, string, DataType, string]> = [
    ["hex", 2, "1111 2222", "unsigned", "286335522"],
    ["hex", 2, "1111 2222", "binary", "00010001 00010001 00100010 00100010"],
    ["unsigned", 2, "286335522", "hex", "1111 2222"],
    ["binary", 2, "11111111 11111111 11111111 11111111", "signed", "-1"],
    ["hex", 4, "0000 0000 0000 0001", "unsigned", "1"],
  ];
  it.each(compositeCases)(
    "范围行 %s×%i「%s」→ %s「%s」",
    (fromType, count, text, toType, expected) => {
      const next = retargetRowDataType(rowWith(fromType, text, count), toType);
      expect(next.dataType).toBe(toType);
      expect(next.cellText).toBe(expected);
    },
  );

  it("范围行新 Type 不支持组合宽度（bool / 未知插件类型）：保留原文，不抛错", () => {
    const boolRow = rowWith("hex", "1111 2222", 2);
    const asBool = retargetRowDataType(boolRow, "bool");
    expect(asBool.dataType).toBe("bool");
    expect(asBool.cellText).toBe("1111 2222");

    const asPlugin = retargetRowDataType(
      rowWith("hex", "1111 2222", 2),
      "my-plugin:speed" as DataType,
    );
    expect(asPlugin.cellText).toBe("1111 2222");
  });

  it("范围行数量非法（count=3 + unsigned）：仍按组合值刷新（类型列错误另行提示）", () => {
    const next = retargetRowDataType(
      rowWith("hex", "0001 0000 0000", 3),
      "unsigned",
    );
    expect(next.dataType).toBe("unsigned");
    expect(next.cellText).toBe("4294967296");
  });

  it("插件类型经 resolver 格式化（ADR-043 E-3）", () => {
    const resolver = createDataTypeResolver();
    resolver.register("my-plugin:speed", {
      parse: (text) =>
        ({ ok: true as const, value: Number(text) || 0 }) as const,
      format: (raw) => `${raw} rpm`,
    });
    const next = retargetRowDataType(
      rowWith("hex", "00AB"),
      "my-plugin:speed" as DataType,
      resolver,
    );
    expect(next.cellText).toBe("171 rpm");
  });
});
