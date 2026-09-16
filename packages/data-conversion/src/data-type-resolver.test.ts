import { describe, expect, it } from "vitest";
import { createDataTypeResolver } from "./data-type-resolver";

describe("DataTypeResolver (ADR-043 E-3)", () => {
  it("内置类型走内置解析/格式化", () => {
    const resolver = createDataTypeResolver();
    expect(resolver.isKnown("hex")).toBe(true);
    expect(resolver.isKnown("bool")).toBe(true);
    expect(resolver.isKnown("my-plugin:speed")).toBe(false);
    const parsed = resolver.parse("00AB", "hex");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toBe(0xab);
    expect(resolver.format(0xab, "hex")).toBe("00AB");
    expect(resolver.registerCounts("bool")).toEqual([1]);
    expect(resolver.isValidRegisterCount("bool", 1)).toBe(true);
    expect(resolver.isValidRegisterCount("bool", 2)).toBe(false);
  });

  it("未注册插件类型解析失败、格式化回退 hex、寄存器数 [1]", () => {
    const resolver = createDataTypeResolver();
    expect(resolver.isKnown("my-plugin:speed")).toBe(false);
    expect(resolver.parse("10", "my-plugin:speed").ok).toBe(false);
    expect(resolver.format(0x1234, "my-plugin:speed")).toBe("1234");
    expect(resolver.registerCounts("my-plugin:speed")).toEqual([1]);
    expect(resolver.isValidRegisterCount("my-plugin:speed", 2)).toBe(false);
  });

  it("register 后插件类型可解析/格式化", () => {
    const resolver = createDataTypeResolver();
    const result = resolver.register("my-plugin:speed", {
      parse: (text) => {
        const value = Number(text);
        return Number.isNaN(value)
          ? {
              ok: false as const,
              error: {
                code: "BAD",
                category: "validation" as const,
                severity: "error" as const,
                retryable: false,
                userMessageKey: "errors.internal",
                technicalMessage: "bad",
              },
            }
          : { ok: true as const, value };
      },
      format: (raw) => `${raw} rpm`,
    });
    expect(result.ok).toBe(true);
    expect(resolver.isKnown("my-plugin:speed")).toBe(true);
    expect(resolver.list()).toEqual(["my-plugin:speed"]);
    const parsed = resolver.parse("1500", "my-plugin:speed");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toBe(1500);
    expect(resolver.format(1500, "my-plugin:speed")).toBe("1500 rpm");
  });

  it("同 id 重复注册返回错误（不覆盖）", () => {
    const resolver = createDataTypeResolver();
    const handlers = {
      parse: (text: string) =>
        ({ ok: true as const, value: Number(text) || 0 }) as const,
      format: (raw: number) => String(raw),
    };
    expect(resolver.register("dup", handlers).ok).toBe(true);
    const second = resolver.register("dup", handlers);
    expect(second.ok).toBe(false);
    if (!second.ok)
      expect(second.error.code).toBe("PLUGIN_DATA_TYPE_ALREADY_REGISTERED");
  });
});
