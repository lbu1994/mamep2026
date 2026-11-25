import { describe, expect, it } from "vitest";
import { en, zh } from "./index";

function flattenTranslations(
  resources: object,
  prefix = "",
): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [name, value] of Object.entries(resources)) {
    const key = prefix === "" ? name : `${prefix}.${name}`;
    if (typeof value === "string") entries[key] = value;
    else if (typeof value === "object" && value !== null) {
      Object.assign(entries, flattenTranslations(value, key));
    }
  }
  return entries;
}

describe("translation resource integrity", () => {
  it("keeps every key and interpolation parameter consistent across languages", () => {
    const english = flattenTranslations(en);
    const chinese = flattenTranslations(zh);
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
    for (const [key, text] of Object.entries(english)) {
      const translated = chinese[key] ?? "";
      expect(translated.trim(), key).not.toBe("");
      const parameters = (value: string): string[] =>
        Array.from(
          value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g),
          (match) => match[1]?.trim() ?? "",
        ).sort();
      expect(parameters(translated), key).toEqual(parameters(text));
    }
  });
});

describe("zh-CN Type labels", () => {
  it("translates every built-in Type option", () => {
    expect({
      hex: zh.table.hex,
      unsigned: zh.table.unsigned,
      signed: zh.table.signed,
      binary: zh.table.binary,
      string: zh.table.string,
      bool: zh.table.bool,
    }).toEqual({
      hex: "十六进制",
      unsigned: "无符号十进制",
      signed: "有符号十进制",
      binary: "二进制",
      string: "字符串",
      bool: "布尔值",
    });
  });
});

describe("连接状态、动作与设置文案", () => {
  it("中英文使用相同语义，并明确区分连接设置与连接动作", () => {
    expect({
      enSettings: en.topbar.connectionSettings,
      zhSettings: zh.topbar.connectionSettings,
      enConnecting: en.state.connecting,
      zhConnecting: zh.state.connecting,
    }).toEqual({
      enSettings: "Connection settings",
      zhSettings: "连接设置",
      enConnecting: "Connecting…",
      zhConnecting: "连接中…",
    });
  });
});

describe("逐行控件可访问名称模板", () => {
  it("中英文都同时表达动作、行号与地址，并保留无地址回退", () => {
    expect({
      en: en.table.rowControlLabel,
      enNoAddress: en.table.rowControlLabelNoAddress,
      enBit: en.table.bitToggleLabel,
      zh: zh.table.rowControlLabel,
      zhNoAddress: zh.table.rowControlLabelNoAddress,
      zhBit: zh.table.bitToggleLabel,
    }).toEqual({
      en: "{{action}} row {{row}}, address {{address}}",
      enNoAddress: "{{action}} row {{row}}",
      enBit: "Toggle bit {{bit}}, row {{row}}, address {{address}}",
      zh: "{{action}}第 {{row}} 行，地址 {{address}}",
      zhNoAddress: "{{action}}第 {{row}} 行",
      zhBit: "切换第 {{bit}} 位，第 {{row}} 行，地址 {{address}}",
    });
  });
});

describe("紧凑控件标签与动作术语", () => {
  it("中英文使用统一的大小写、冒号和协议术语", () => {
    expect({
      enAddress: en.table.addressRadixLabel,
      enSlaveAddress: en.table.slaveAddressLabel,
      enUnitId: en.table.unitIdLabel,
      enVerify: en.table.writeVerifyLabel,
      zhAddress: zh.table.addressRadixLabel,
      zhSlaveAddress: zh.table.slaveAddressLabel,
      zhUnitId: zh.table.unitIdLabel,
      zhVerify: zh.table.writeVerifyLabel,
    }).toEqual({
      enAddress: "Address:",
      enSlaveAddress: "Slave Address:",
      enUnitId: "Unit ID:",
      enVerify: "Verify:",
      zhAddress: "地址：",
      zhSlaveAddress: "从站地址：",
      zhUnitId: "单元 ID：",
      zhVerify: "回读：",
    });
  });

  it("选中行动作和读取全表动作使用同一动词短语", () => {
    expect({
      enReadAll: en.topbar.readAll,
      enReadSelected: en.keyboard.readSelected,
      enWriteSelected: en.keyboard.writeSelected,
      zhReadAll: zh.topbar.readAll,
      zhReadSelected: zh.keyboard.readSelected,
      zhWriteSelected: zh.keyboard.writeSelected,
    }).toEqual({
      enReadAll: "Read All",
      enReadSelected: "Read Selected Rows",
      enWriteSelected: "Write Selected Rows",
      zhReadAll: "读取全表",
      zhReadSelected: "读取选中行",
      zhWriteSelected: "写入选中行",
    });
  });

  it("可编辑单元格名称同时包含列头、行号、地址和表类型", () => {
    expect({
      en: en.table.editableCellLabel,
      enNoAddress: en.table.editableCellLabelNoAddress,
      zh: zh.table.editableCellLabel,
      zhNoAddress: zh.table.editableCellLabelNoAddress,
    }).toEqual({
      en: "{{column}}, row {{row}}, address {{address}}, table type {{tableType}}",
      enNoAddress: "{{column}}, row {{row}}, table type {{tableType}}",
      zh: "{{column}}，第 {{row}} 行，地址 {{address}}，表类型：{{tableType}}",
      zhNoAddress: "{{column}}，第 {{row}} 行，表类型：{{tableType}}",
    });
  });
});
