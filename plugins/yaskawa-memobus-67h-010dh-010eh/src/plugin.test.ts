import { describe, expect, it } from "vitest";
import { createCodecRegistry } from "@mamep2026/communication";
import {
  BUILTIN_CONTRIBUTION_POINTS,
  ContributionPointRegistry,
  PluginRegistry,
} from "@mamep2026/plugin-api";
import {
  YASKAWA_MEMOBUS_PLUGIN_ID,
  YASKAWA_MEMOBUS_PROTOCOL_ID,
  registerYaskawaPlugin,
} from "./plugin";

function makeRegistry() {
  const contributionRegistry = new ContributionPointRegistry();
  for (const point of BUILTIN_CONTRIBUTION_POINTS) {
    contributionRegistry.registerPoint(point);
  }
  const registry = new PluginRegistry({ contributionRegistry });
  return { registry, contributionRegistry };
}

describe("Yaskawa MEMOBUS 插件（ADR-041，决策①1A/⑤）", () => {
  it("注册成功：activate 把 MemobusCodec 注册进会话 CodecRegistry", () => {
    const { registry } = makeRegistry();
    const codecRegistry = createCodecRegistry();
    const result = registerYaskawaPlugin(registry, { codecRegistry });
    expect(result.ok).toBe(true);
    expect(registry.list().map((m) => m.id)).toContain(
      YASKAWA_MEMOBUS_PLUGIN_ID,
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
    const { registry, contributionRegistry } = makeRegistry();
    const codecRegistry = createCodecRegistry();
    registerYaskawaPlugin(registry, { codecRegistry });

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

    const toolbarActions = contributionRegistry.getContributions<
      Array<{ id: string; titleKey: string }>
    >("toolbarAction");
    expect(toolbarActions).toHaveLength(1);
    expect(toolbarActions[0]?.payload.map((a) => a.id)).toEqual([
      "yaskawa.enter-rom",
      "yaskawa.enter-ram",
    ]);

    const commands = contributionRegistry.getContributions<
      Array<{ id: string }>
    >("command");
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
    const { registry, contributionRegistry } = makeRegistry();
    const codecRegistry = createCodecRegistry();
    registerYaskawaPlugin(registry, { codecRegistry });
    registry.setEnabled(YASKAWA_MEMOBUS_PLUGIN_ID, false);
    expect(contributionRegistry.getContributions("tableType")).toHaveLength(0);
    expect(
      registry.getLifecycleState(YASKAWA_MEMOBUS_PLUGIN_ID),
    ).toBe("deactivated");
  });
});
