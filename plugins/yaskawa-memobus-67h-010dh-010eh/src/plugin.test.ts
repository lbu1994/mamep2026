import { describe, expect, it, vi } from "vitest";
import { createCodecRegistry } from "@mamep2026/communication";
import { ok } from "@mamep2026/domain";
import {
  BUILTIN_CONTRIBUTION_POINTS,
  ContributionPointRegistry,
  PLUGIN_API_VERSION,
  PluginRegistry,
  createAddressTransformRegistry,
  createDataTypeRegistry,
  runtimeFromLocalEntry,
  type PluginCommunicationApi,
  type PluginSyncRegistries,
} from "@mamep2026/plugin-api";
import * as pluginEntry from "./plugin";
import {
  YASKAWA_MEMOBUS_PLUGIN_ID,
  YASKAWA_MEMOBUS_PROTOCOL_ID,
} from "./plugin";

/**
 * 装配测试夹具（ADR-054）：真 codec 注册表作为同步注册面，按装配层同样方式把单文件 entry
 * 注册为 installed + same-process 插件。
 */
function makeHarness(
  options: {
    communicationApiFactory?: (pluginId: string) => PluginCommunicationApi;
  } = {},
) {
  const contributionRegistry = new ContributionPointRegistry();
  for (const point of BUILTIN_CONTRIBUTION_POINTS) {
    contributionRegistry.registerPoint(point);
  }
  const codecRegistry = createCodecRegistry();
  const registries: PluginSyncRegistries = {
    codec: {
      register: (codec) => {
        codecRegistry.register(codec);
        return ok(undefined);
      },
      list: () => codecRegistry.list(),
    },
    dataType: createDataTypeRegistry(),
    addressTransform: createAddressTransformRegistry(),
  };
  const registry = new PluginRegistry({
    contributionRegistry,
    syncRegistries: registries,
    ...(options.communicationApiFactory !== undefined
      ? { communicationApiFactory: options.communicationApiFactory }
      : {}),
  });
  const result = registry.register(pluginEntry.manifest, {
    source: "installed",
    runtime: runtimeFromLocalEntry(pluginEntry),
    entrySource: "export const manifest = {};",
    executionMode: "same-process",
  });
  return { registry, contributionRegistry, codecRegistry, result };
}

describe("Yaskawa MEMOBUS 插件（ADR-041；ADR-054 单文件手动安装）", () => {
  it("单文件 entry 导出 manifest（apiVersion 跟随 PLUGIN_API_VERSION）", () => {
    expect(pluginEntry.manifest.id).toBe(YASKAWA_MEMOBUS_PLUGIN_ID);
    expect(pluginEntry.manifest.apiVersion).toBe(PLUGIN_API_VERSION);
  });

  it("装配：installed + same-process，activate 把 MemobusCodec 注册进会话 CodecRegistry", () => {
    const { registry, codecRegistry, result } = makeHarness();
    expect(result.ok).toBe(true);
    expect(registry.list().map((m) => m.id)).toContain(
      YASKAWA_MEMOBUS_PLUGIN_ID,
    );
    expect(registry.getSource(YASKAWA_MEMOBUS_PLUGIN_ID)).toBe("installed");
    expect(registry.getExecutionMode(YASKAWA_MEMOBUS_PLUGIN_ID)).toBe(
      "same-process",
    );
    expect(codecRegistry.list()).toEqual([YASKAWA_MEMOBUS_PROTOCOL_ID]);
    expect(codecRegistry.get(YASKAWA_MEMOBUS_PROTOCOL_ID)?.protocolId).toBe(
      YASKAWA_MEMOBUS_PROTOCOL_ID,
    );
    expect(registry.getLifecycleState(YASKAWA_MEMOBUS_PLUGIN_ID)).toBe(
      "active",
    );
  });

  it("声明式贡献被聚合：tableType / protocolExtension / toolbarAction / command", () => {
    const { contributionRegistry } = makeHarness();

    const tableTypes = contributionRegistry.getContributions<{
      id: string;
      protocolId: string;
    }>("tableType");
    expect(tableTypes).toHaveLength(1);
    expect(tableTypes[0]?.payload.protocolId).toBe(YASKAWA_MEMOBUS_PROTOCOL_ID);

    const protocolExtensions = contributionRegistry.getContributions<{
      protocolId: string;
    }>("protocolExtension");
    expect(protocolExtensions).toHaveLength(1);
    expect(protocolExtensions[0]?.payload.protocolId).toBe(
      YASKAWA_MEMOBUS_PROTOCOL_ID,
    );

    const toolbarActions =
      contributionRegistry.getContributions<
        Array<{ id: string; titleKey: string }>
      >("toolbarAction");
    expect(toolbarActions).toHaveLength(1);
    expect(toolbarActions[0]?.payload.map((a) => a.id)).toEqual([
      "yaskawa.enter-rom",
      "yaskawa.enter-ram",
    ]);

    const commands =
      contributionRegistry.getContributions<Array<{ id: string }>>("command");
    expect(commands).toHaveLength(1);
    expect(commands[0]?.payload.map((c) => c.id)).toEqual([
      "yaskawa.enter-rom",
      "yaskawa.enter-ram",
    ]);

    // 寄存器手册（ADR-043 E-5）：documentation 贡献点含 markdown。
    const docs = contributionRegistry.getContributions<{
      id: string;
      titleKey: string;
      markdown: string;
    }>("documentation");
    expect(docs).toHaveLength(1);
    expect(docs[0]?.payload.id).toBe("yaskawa.register-manual");
    expect(docs[0]?.payload.markdown.length).toBeGreaterThan(50);
  });

  it("禁用插件后贡献被过滤、生命周期 deactivated", () => {
    const { registry, contributionRegistry } = makeHarness();
    registry.setEnabled(YASKAWA_MEMOBUS_PLUGIN_ID, false);
    expect(contributionRegistry.getContributions("tableType")).toHaveLength(0);
    expect(registry.getLifecycleState(YASKAWA_MEMOBUS_PLUGIN_ID)).toBe(
      "deactivated",
    );
  });

  it("handleToolbarAction：enter-rom/enter-ram 经通信面写 0 到 0900H/0910H", async () => {
    const writes: Array<{ address: number; values: number[] }> = [];
    const communicationApiFactory = vi.fn(
      (_pluginId: string): PluginCommunicationApi => ({
        readRegisters: vi.fn(async () => ({ ok: true as const, value: [1] })),
        writeRegisters: vi.fn(
          async (req: { address: number; values: number[] }) => {
            writes.push(req);
            return { ok: true as const, value: undefined };
          },
        ),
      }),
    );
    const { registry } = makeHarness({ communicationApiFactory });

    expect(
      registry.canHandleToolbarAction(
        YASKAWA_MEMOBUS_PLUGIN_ID,
        "yaskawa.enter-rom",
      ),
    ).toBe(true);
    const rom = await registry.invokeToolbarAction(
      YASKAWA_MEMOBUS_PLUGIN_ID,
      "yaskawa.enter-rom",
    );
    expect(rom.ok).toBe(true);
    expect(writes).toEqual([{ address: 0x0900, values: [0] }]);

    const ram = await registry.invokeToolbarAction(
      YASKAWA_MEMOBUS_PLUGIN_ID,
      "yaskawa.enter-ram",
    );
    expect(ram.ok).toBe(true);
    expect(writes[1]).toEqual({ address: 0x0910, values: [0] });
  });
});
