import { describe, expect, it } from "vitest";
import {
  BUILTIN_CONTRIBUTION_POINTS,
  ContributionPointRegistry,
  PluginRegistry,
  createAddressTransformRegistry,
} from "@mamep2026/plugin-api";
import {
  ADDRESS_ADJUST_PLUGIN_ID,
  createAddressAdjustRuntime,
  registerAddressAdjustPlugin,
  resolveAddressAdjustTransform,
} from "./plugin";
import { ADDRESS_ADJUST_TRANSFORM } from "./address-adjust-transform";

function makeRegistry() {
  const contributionRegistry = new ContributionPointRegistry();
  for (const point of BUILTIN_CONTRIBUTION_POINTS) {
    contributionRegistry.registerPoint(point);
  }
  return new PluginRegistry({ contributionRegistry });
}

describe("address-adjust 插件（2026-09-02 插件外部化：自 App.tsx/register-table 移出）", () => {
  it("注册成功：installed 来源 + 同进程 runtime，activate 注册变换", () => {
    const registry = makeRegistry();
    const transformRegistry = createAddressTransformRegistry();
    const result = registerAddressAdjustPlugin(registry, { transformRegistry });
    expect(result.ok).toBe(true);
    expect(registry.getSource(ADDRESS_ADJUST_PLUGIN_ID)).toBe("installed");
    expect(registry.getRuntime(ADDRESS_ADJUST_PLUGIN_ID)).toBeDefined();
    expect(transformRegistry.get("builtin.address-adjust")).toBeDefined();
  });

  it("保留现名：插件 id 与 transformId 不变（工作区数据零迁移，用户决策 2026-09-02）", () => {
    expect(ADDRESS_ADJUST_PLUGIN_ID).toBe("builtin-address-adjust");
    expect(ADDRESS_ADJUST_TRANSFORM.id).toBe("builtin.address-adjust");
  });

  it("变换语义：发送 = 用户地址 − 1；0 下溢 ADDRESS_ADJUST_UNDERFLOW", () => {
    expect(ADDRESS_ADJUST_TRANSFORM.apply(0x0100)).toEqual({ ok: true, value: 0xff });
    const underflow = ADDRESS_ADJUST_TRANSFORM.apply(0);
    expect(underflow.ok).toBe(false);
    if (!underflow.ok) {
      expect(underflow.error.code).toBe("ADDRESS_ADJUST_UNDERFLOW");
      expect(underflow.error.category).toBe("validation");
    }
    const validateResult = ADDRESS_ADJUST_TRANSFORM.validate(1);
    expect(validateResult.ok).toBe(true);
  });

  it("resolveAddressAdjustTransform：仅解析内建 id；未知返回 null", () => {
    expect(resolveAddressAdjustTransform("builtin.address-adjust")).not.toBeNull();
    expect(
      resolveAddressAdjustTransform("unknown.transform"),
    ).toBeNull();
  });

  it("createAddressAdjustRuntime 可重复构造（重启恢复 attach 用）", () => {
    const transformRegistry = createAddressTransformRegistry();
    const runtime = createAddressAdjustRuntime({ transformRegistry });
    runtime.activate();
    expect(transformRegistry.get("builtin.address-adjust")).toBeDefined();
  });
});
