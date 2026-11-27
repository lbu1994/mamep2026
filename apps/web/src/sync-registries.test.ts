import { describe, expect, it } from "vitest";
import {
  createCodecRegistry,
  registerBasicTablesCodecs,
  type ProtocolCodec,
} from "@mamep2026/communication";
import { createDataTypeResolver } from "@mamep2026/data-conversion";
import {
  PluginRegistry,
  createAddressTransformRegistry,
  type PluginContext,
} from "@mamep2026/plugin-api";
import { createPluginSyncRegistries } from "./sync-registries";

const codec: ProtocolCodec = {
  protocolId: "vendor",
  encodeRead: () => new Uint8Array([1]),
  encodeWrite: () => new Uint8Array([2]),
  decodeResponse: () => ({ ok: true, value: { kind: "write" } }),
  parserFactory: () => ({ push: () => ({ done: false }) }),
  expectedLength: () => ({ normal: 1, exception: 1 }),
};

function setup() {
  const codecs = createCodecRegistry();
  registerBasicTablesCodecs(codecs);
  const coreIds = codecs.list();
  const registry = new PluginRegistry({
    syncRegistries: createPluginSyncRegistries({
      codecRegistry: codecs,
      dataTypeResolver: createDataTypeResolver(),
      addressTransformRegistry: createAddressTransformRegistry(),
    }),
  });
  const contexts: PluginContext[] = [];
  const install = (fail = false) =>
    registry.register(
      {
        id: "vendor",
        name: "Vendor",
        version: "1.0.0",
        apiVersion: "2.0",
        description: "Codec lifecycle fixture",
        platform: { web: true, node: true },
        permissions: [],
        contributes: {},
      },
      {
        source: "installed",
        runtime: {
          activate(ctx) {
            contexts.push(ctx);
            expect(ctx.registries.codec.register(codec).ok).toBe(true);
            if (fail) throw new Error("activation failed after registration");
          },
        },
      },
    );
  return { codecs, coreIds, registry, contexts, install };
}

describe("plugin codec scopes in the shared host adapter", () => {
  it.each(["disable", "uninstall", "dispose"] as const)(
    "revokes codecs on %s without removing core codecs",
    async (action) => {
      const { codecs, coreIds, registry, contexts, install } = setup();
      expect(install().ok).toBe(true);
      const lease = codecs.capture("vendor");
      if (action === "disable") await registry.setEnabled("vendor", false);
      else if (action === "uninstall") registry.unregister("vendor");
      else await registry.dispose();
      expect(codecs.list()).toEqual(coreIds);
      expect(lease?.isCurrent()).toBe(false);
      expect(contexts[0]?.registries.codec.register(codec)).toMatchObject({
        ok: false,
      });
      expect(contexts[0]?.registries).not.toHaveProperty("createCodecScope");
      expect(contexts[0]?.registries.codec).not.toHaveProperty("dispose");
      await registry.dispose();
    },
  );

  it.each(["enable", "reinstall"] as const)(
    "creates a new generation on %s even for the same codec object",
    async (action) => {
      const { codecs, registry, contexts, install } = setup();
      install();
      const lease = codecs.capture("vendor");
      if (action === "enable") {
        await registry.setEnabled("vendor", false);
        await registry.setEnabled("vendor", true);
      } else {
        registry.unregister("vendor");
        install();
      }
      expect(codecs.get("vendor")).toBe(codec);
      expect(lease?.isCurrent()).toBe(false);
      expect(contexts[0]?.registries.codec.register(codec)).toMatchObject({
        ok: false,
      });
      expect(contexts[1]?.registries.codec.register(codec).ok).toBe(true);
      await registry.dispose();
    },
  );

  it("removes partially registered codecs after activation failure", async () => {
    const { codecs, coreIds, registry, contexts, install } = setup();
    install(true);
    expect(registry.getLifecycleState("vendor")).toBe("failed");
    expect(codecs.list()).toEqual(coreIds);
    expect(contexts[0]?.registries.codec.register(codec)).toMatchObject({
      ok: false,
    });
    await registry.dispose();
  });
});
