import { describe, expect, it } from "vitest";
import { createDataTypeRegistry } from "./data-type";

describe("DataTypeRegistry（ADR-043 E-3）", () => {
  it("register/get/list：注册顺序保留，同 id 重复注册报错", () => {
    const registry = createDataTypeRegistry();
    const handlers = {
      parse: (text: string) =>
        ({ ok: true as const, value: Number(text) || 0 }) as const,
      format: (raw: number) => String(raw),
    };
    expect(registry.register("my-plugin:speed", handlers).ok).toBe(true);
    expect(registry.register("my-plugin:mode", handlers).ok).toBe(true);
    expect(registry.list()).toEqual(["my-plugin:speed", "my-plugin:mode"]);
    expect(registry.get("my-plugin:speed")).toBeDefined();
    expect(registry.get("nope")).toBeUndefined();

    const dup = registry.register("my-plugin:speed", handlers);
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.error.code).toBe("PLUGIN_DATA_TYPE_ALREADY_REGISTERED");
    }
  });
});
