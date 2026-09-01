import { describe, expect, it } from "vitest";
import { ok } from "@mamep2026/domain";
import { createAddressTransformRegistry } from "./address-transform";

describe("AddressTransformRegistry（ADR-042）", () => {
  const transform = {
    id: "builtin.address-adjust",
    protocol: "rtu",
    titleKey: "table.addressAdjust",
    defaultConfig: { enabled: false },
    apply: (userAddress: number) => ok(userAddress - 1),
  };

  it("registers and lists transforms in registration order", () => {
    const registry = createAddressTransformRegistry();
    const result = registry.register(transform);
    expect(result.ok).toBe(true);
    expect(registry.list()).toEqual([transform]);
    expect(registry.get("builtin.address-adjust")).toBe(transform);
  });

  it("rejects duplicate id registration (no overwrite)", () => {
    const registry = createAddressTransformRegistry();
    registry.register(transform);
    const dup = registry.register({
      ...transform,
      apply: () => ok(0),
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.error.code).toBe("PLUGIN_TRANSFORM_ALREADY_REGISTERED");
    }
    // 原变换保留。
    expect(registry.get("builtin.address-adjust")?.apply(5)).toEqual(ok(4));
  });

  it("returns undefined for unknown id and empty list initially", () => {
    const registry = createAddressTransformRegistry();
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.list()).toEqual([]);
  });
});
