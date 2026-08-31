import { describe, expect, it } from "vitest";
import {
  normalizePermissions,
  PERMISSION_LABEL_KEYS,
  permissionIdSchema,
  validatePermissions,
  type PermissionId,
} from "./permissions";

describe("permissions（ADR-039：类型化权限枚举）", () => {
  it("合法权限数组通过校验", () => {
    const result = validatePermissions(["communication", "theme"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(["communication", "theme"]);
  });

  it("未知权限拒绝（PLUGIN_PERMISSION_DENIED）", () => {
    const result = validatePermissions(["ui.panel", "theme"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PLUGIN_PERMISSION_DENIED");
  });

  it("非数组拒绝", () => {
    expect(validatePermissions("theme").ok).toBe(false);
    expect(validatePermissions(undefined).ok).toBe(false);
  });

  it("permissionIdSchema 枚举与 PERMISSION_LABEL_KEYS 覆盖一致", () => {
    for (const id of Object.keys(PERMISSION_LABEL_KEYS) as PermissionId[]) {
      expect(permissionIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("normalizePermissions 筛出合法项、丢弃非法项", () => {
    expect(normalizePermissions(["ui.panel", "theme", "bogus"])).toEqual([
      "theme",
    ]);
    expect(normalizePermissions("not-array")).toEqual([]);
    expect(normalizePermissions(undefined)).toEqual([]);
  });
});
