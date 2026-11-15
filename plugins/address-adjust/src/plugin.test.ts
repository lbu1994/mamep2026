import { describe, expect, it } from "vitest";
import { ok } from "@mamep2026/domain";
import {
  BUILTIN_CONTRIBUTION_POINTS,
  ContributionPointRegistry,
  PLUGIN_API_VERSION,
  PluginRegistry,
  createAddressTransformRegistry,
  createDataTypeRegistry,
  createUnavailableCommunicationApi,
  runtimeFromLocalEntry,
  type PluginContext,
  type PluginSyncRegistries,
} from "@mamep2026/plugin-api";
import * as pluginEntry from "./plugin";
import { ADDRESS_ADJUST_PLUGIN_ID, manifest } from "./plugin";
import {
  ADDRESS_ADJUST_TRANSFORM,
  resolveAddressAdjustTransform,
} from "./address-adjust-transform";

function makeRegistry(registries?: PluginSyncRegistries) {
  const contributionRegistry = new ContributionPointRegistry();
  for (const point of BUILTIN_CONTRIBUTION_POINTS) {
    contributionRegistry.registerPoint(point);
  }
  return new PluginRegistry({
    contributionRegistry,
    ...(registries !== undefined ? { syncRegistries: registries } : {}),
  });
}

/** 测试用同步注册面（真地址变换注册表 + 假 codec 注册面）。 */
function makeSyncRegistries(
  addressTransform = createAddressTransformRegistry(),
): PluginSyncRegistries {
  return {
    codec: { register: () => ok(undefined), list: () => [] },
    dataType: createDataTypeRegistry(),
    addressTransform,
  };
}

/** 插件上下文：由装配层/注册表注入。 */
function makeContext(registries: PluginSyncRegistries): PluginContext {
  return {
    pluginId: ADDRESS_ADJUST_PLUGIN_ID,
    communication: createUnavailableCommunicationApi(),
    registries,
  };
}

describe("address-adjust 插件（ADR-054：用户手动安装的单文件插件）", () => {
  it("单文件 entry 导出 manifest（apiVersion 跟随 PLUGIN_API_VERSION）", () => {
    expect(manifest.id).toBe(ADDRESS_ADJUST_PLUGIN_ID);
    expect(manifest.apiVersion).toBe(PLUGIN_API_VERSION);
    expect(manifest.contributes.addressTransform).toMatchObject({
      id: "builtin.address-adjust",
    });
  });

  it("activate 经 ctx.registries.addressTransform 注册变换", () => {
    const transformRegistry = createAddressTransformRegistry();
    pluginEntry.activate(makeContext(makeSyncRegistries(transformRegistry)));
    expect(transformRegistry.get("builtin.address-adjust")).toBeDefined();
  });

  it("重复 activate 注册失败时抛错（错误隔离 → PLUGIN_HOOK_FAILED）", () => {
    const transformRegistry = createAddressTransformRegistry();
    pluginEntry.activate(makeContext(makeSyncRegistries(transformRegistry)));
    expect(() =>
      pluginEntry.activate(makeContext(makeSyncRegistries(transformRegistry))),
    ).toThrow(/address transform/i);
  });

  it("经注册表装配：installed 来源 + executionMode=same-process + 贡献聚合", () => {
    const transformRegistry = createAddressTransformRegistry();
    const registry = makeRegistry(makeSyncRegistries(transformRegistry));
    const result = registry.register(pluginEntry.manifest, {
      source: "installed",
      runtime: runtimeFromLocalEntry(pluginEntry),
      entrySource: "export const manifest = {};",
      executionMode: "same-process",
    });
    expect(result.ok).toBe(true);
    expect(registry.getSource(ADDRESS_ADJUST_PLUGIN_ID)).toBe("installed");
    expect(registry.getExecutionMode(ADDRESS_ADJUST_PLUGIN_ID)).toBe(
      "same-process",
    );
    expect(registry.getLifecycleState(ADDRESS_ADJUST_PLUGIN_ID)).toBe("active");
    expect(transformRegistry.get("builtin.address-adjust")).toBeDefined();
    expect(registry.getContributions("addressTransform")).toHaveLength(1);
  });

  it("保留现名：插件 id 与 transformId 不变（工作区数据零迁移，用户决策 2026-09-02）", () => {
    expect(ADDRESS_ADJUST_PLUGIN_ID).toBe("builtin-address-adjust");
    expect(ADDRESS_ADJUST_TRANSFORM.id).toBe("builtin.address-adjust");
  });

  it("变换语义：发送 = 用户地址 − 1；0 下溢 ADDRESS_ADJUST_UNDERFLOW", () => {
    expect(ADDRESS_ADJUST_TRANSFORM.apply(0x0100)).toEqual({
      ok: true,
      value: 0xff,
    });
    const underflow = ADDRESS_ADJUST_TRANSFORM.apply(0);
    expect(underflow.ok).toBe(false);
    if (!underflow.ok) {
      expect(underflow.error.code).toBe("ADDRESS_ADJUST_UNDERFLOW");
      expect(underflow.error.category).toBe("validation");
    }
    // AddressTransform.validate 为可选字段（domain 类型），此处用可选链调用。
    const validateResult = ADDRESS_ADJUST_TRANSFORM.validate?.(1);
    expect(validateResult?.ok).toBe(true);
  });

  it("resolveAddressAdjustTransform：仅解析内建 id；未知返回 null", () => {
    expect(
      resolveAddressAdjustTransform("builtin.address-adjust"),
    ).not.toBeNull();
    expect(resolveAddressAdjustTransform("unknown.transform")).toBeNull();
  });
});
