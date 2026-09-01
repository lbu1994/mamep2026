import { describe, expect, it } from "vitest";
import { createCodecRegistry } from "@mamep2026/communication";
import { createDataTypeResolver } from "@mamep2026/data-conversion";
import {
  BUILTIN_CONTRIBUTION_POINTS,
  ContributionPointRegistry,
  PluginRegistry,
} from "@mamep2026/plugin-api";
import {
  CUSTOM_FUNCTION_PLUGIN_ID,
  CUSTOM_PLUGIN_DATA_TYPE,
  CUSTOM_FUNCTION_PROTOCOL_ID,
  registerCustomFunctionPlugin,
} from "./plugin";

function makeRegistry() {
  const contributionRegistry = new ContributionPointRegistry();
  for (const point of BUILTIN_CONTRIBUTION_POINTS) {
    contributionRegistry.registerPoint(point);
  }
  const registry = new PluginRegistry({ contributionRegistry });
  return { registry, contributionRegistry };
}

describe("registerCustomFunctionPlugin（ADR-043 E-4）", () => {
  it("声明 protocolExtension/tableType/toolbarAction/dataType 贡献", () => {
    const { registry, contributionRegistry } = makeRegistry();
    const codecRegistry = createCodecRegistry();
    const dataTypeResolver = createDataTypeResolver();
    const result = registerCustomFunctionPlugin(registry, {
      codecRegistry,
      dataTypeResolver,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

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

  it("activate 把 codec 注册进 CodecRegistry、插件 dataType 注册进 resolver", () => {
    const { registry } = makeRegistry();
    const codecRegistry = createCodecRegistry();
    const dataTypeResolver = createDataTypeResolver();
    registerCustomFunctionPlugin(registry, {
      codecRegistry,
      dataTypeResolver,
    });

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

  it("插件 id 唯一", () => {
    expect(CUSTOM_FUNCTION_PLUGIN_ID).toBe("custom-function-code");
  });
});
