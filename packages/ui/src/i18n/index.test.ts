import { describe, expect, it } from "vitest";
import { en, zh } from "./index";

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
