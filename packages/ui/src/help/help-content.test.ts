import { describe, expect, it } from "vitest";
import { resolveHelpContent } from "./help-content";

describe("帮助正文与界面术语", () => {
  it("中英文帮助使用与工具栏一致的概念名和紧凑标签格式", () => {
    const enConnection = resolveHelpContent("connection", "en-US");
    const enTable = resolveHelpContent("register-table", "en-US");
    const zhConnection = resolveHelpContent("connection", "zh-CN");
    const zhTable = resolveHelpContent("register-table", "zh-CN");

    expect(enConnection).toContain("**Slave Address:**");
    expect(enConnection).toContain("**Unit ID:**");
    expect(enTable).toContain("**Address:**");
    expect(enTable).toContain("**Slave Address:**");
    expect(enTable).toContain("**Unit ID:**");
    expect(enTable).toContain("**Verify:**");

    expect(zhConnection).toContain("**从站地址：**");
    expect(zhConnection).toContain("**单元 ID：**");
    expect(zhTable).toContain("**地址：**");
    expect(zhTable).toContain("**从站地址：**");
    expect(zhTable).toContain("**单元 ID：**");
    expect(zhTable).toContain("**回读：**");
  });

  it("读写与插件帮助复用界面动作词和本地化名称", () => {
    const enReadWrite = resolveHelpContent("read-write", "en-US");
    const zhReadWrite = resolveHelpContent("read-write", "zh-CN");
    const zhPlugins = resolveHelpContent("plugins", "zh-CN");

    expect(enReadWrite).toContain("**Read All**");
    expect(enReadWrite).toContain("**Read Selected Rows**");
    expect(enReadWrite).toContain("**Write Selected Rows**");
    expect(enReadWrite).toContain("**Verify:**");
    expect(zhReadWrite).toContain("**读取全表**");
    expect(zhReadWrite).toContain("**读取选中行**");
    expect(zhReadWrite).toContain("**写入选中行**");
    expect(zhReadWrite).toContain("**回读：**");
    expect(zhReadWrite).not.toContain("全表读取");
    expect(zhPlugins).toContain("**安装插件**");
    expect(zhPlugins).not.toContain("Install Plugin");
  });
});
