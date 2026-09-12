import { describe, expect, it } from "vitest";
import { createCodecRegistry } from "@mamep2026/communication";
import { createDataTypeResolver } from "@mamep2026/data-conversion";
import { ok } from "@mamep2026/domain";
import {
  BUILTIN_CONTRIBUTION_POINTS,
  ContributionPointRegistry,
  PLUGIN_API_VERSION,
  PluginRegistry,
  createAddressTransformRegistry,
  runtimeFromLocalEntry,
  type PluginSyncRegistries,
} from "@mamep2026/plugin-api";
import * as pluginEntry from "./plugin";
import {
  CUSTOM_FUNCTION_PLUGIN_ID,
  CUSTOM_PLUGIN_DATA_TYPE,
  CUSTOM_FUNCTION_PROTOCOL_ID,
} from "./plugin";

/**
 * 装配测试夹具（ADR-054）：真 codec 注册表 + 真 dataType 解析器作为同步注册面，
 * 按装配层同样方式把单文件 entry 注册为 installed + same-process 插件。
 */
function makeHarness() {
  const codecRegistry = createCodecRegistry();
  const dataTypeResolver = createDataTypeResolver();
  const contributionRegistry = new ContributionPointRegistry();
  for (const point of BUILTIN_CONTRIBUTION_POINTS) {
    contributionRegistry.registerPoint(point);
  }
  const registries: PluginSyncRegistries = {
    codec: {
      register: (codec) => {
        codecRegistry.register(codec);
        return ok(undefined);
      },
      list: () => codecRegistry.list(),
    },
    dataType: dataTypeResolver,
    addressTransform: createAddressTransformRegistry(),
  };
  const registry = new PluginRegistry({
    contributionRegistry,
    syncRegistries: registries,
  });
  const result = registry.register(pluginEntry.manifest, {
    source: "installed",
    runtime: runtimeFromLocalEntry(pluginEntry),
    entrySource: "export const manifest = {};",
    executionMode: "same-process",
  });
  return { registry, contributionRegistry, codecRegistry, dataTypeResolver, result };
}

describe("custom-function-code 插件（ADR-054：用户手动安装的单文件插件）", () => {
  it("单文件 entry 导出 manifest（apiVersion 跟随 PLUGIN_API_VERSION）", () => {
    expect(pluginEntry.manifest.id).toBe(CUSTOM_FUNCTION_PLUGIN_ID);
    expect(pluginEntry.manifest.apiVersion).toBe(PLUGIN_API_VERSION);
  });

  it("装配：installed + same-process，activate 注册 codec 与插件 dataType", () => {
    const { registry, codecRegistry, dataTypeResolver, result } = makeHarness();
    expect(result.ok).toBe(true);
    expect(registry.getSource(CUSTOM_FUNCTION_PLUGIN_ID)).toBe("installed");
    expect(registry.getExecutionMode(CUSTOM_FUNCTION_PLUGIN_ID)).toBe(
      "same-process",
    );
    expect(registry.getLifecycleState(CUSTOM_FUNCTION_PLUGIN_ID)).toBe("active");

    // activate 已执行：codec 可解析。
    expect(codecRegistry.get(CUSTOM_FUNCTION_PROTOCOL_ID)).toBeDefined();
    // 插件 dataType 已注册：解析/格式化生效。
    expect(dataTypeResolver.isKnown(CUSTOM_PLUGIN_DATA_TYPE)).toBe(true);
    const parsed = dataTypeResolver.parse("12.5", CUSTOM_PLUGIN_DATA_TYPE);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toBe(125);
    expect(dataTypeResolver.format(125, CUSTOM_PLUGIN_DATA_TYPE)).toBe("12.5");
    // 非法输入失败。
    const bad = dataTypeResolver.parse("abc", CUSTOM_PLUGIN_DATA_TYPE);
    expect(bad.ok).toBe(false);
  });

  it("声明 protocolExtension/tableType/toolbarAction/dataType 贡献", () => {
    const { contributionRegistry } = makeHarness();

    const protocolExtensions = contributionRegistry.getContributions<{
      protocolId: string;
    }>("protocolExtension");
    expect(protocolExtensions).toHaveLength(1);
    expect(protocolExtensions[0]?.payload.protocolId).toBe(
      CUSTOM_FUNCTION_PROTOCOL_ID,
    );

    const tableTypes = contributionRegistry.getContributions<{ id: string }>(
      "tableType",
    );
    expect(tableTypes[0]?.payload.id).toBe("holding-register");

    const actions = contributionRegistry.getContributions<{ id: string }[]>(
      "toolbarAction",
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.payload[0]?.id).toBe("custom-function.zero");

    const dataTypes = contributionRegistry.getContributions<{ id: string }>(
      "dataType",
    );
    expect(dataTypes[0]?.payload.id).toBe(CUSTOM_PLUGIN_DATA_TYPE);
  });

  it("插件 id 唯一", () => {
    expect(CUSTOM_FUNCTION_PLUGIN_ID).toBe("custom-function-code");
  });
});
