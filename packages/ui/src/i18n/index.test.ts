import { describe, expect, it } from "vitest";
import { zh } from "./index";

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
