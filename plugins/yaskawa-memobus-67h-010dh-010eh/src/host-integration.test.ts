import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CommunicationSession,
  createCodecRegistry,
  registerBasicTablesCodecs,
} from "@mamep2026/communication";
import {
  createDefaultRtuProfile,
  createDefaultTcpProfile,
  ok,
} from "@mamep2026/domain";
import {
  BUILTIN_CONTRIBUTION_POINTS,
  ContributionPointRegistry,
  PluginRegistry,
  pluginApprovalContent,
  pluginManifestSchema,
  type PluginStoreData,
  type PluginStorePort,
  type StoredPlugin,
} from "@mamep2026/plugin-api";
import { createHostPluginRuntime } from "@mamep2026/platform-node/plugin";
import { FakeTransport, VirtualClock } from "@mamep2026/test-kit";
import { yaskawaMemobusManifest } from "./plugin";

const protocol = yaskawaMemobusManifest.id;
const request = [1, 0x67, 1, 0x0d, 0, 2, 0, 0x24, 0, 0x28, 0x8b, 0x29];
const response = [1, 0x67, 1, 0x0d, 0, 4, 0x17, 0x70, 3, 0xe8, 0x47, 0xed];
let source = "";

beforeAll(async () => {
  // Match the distributable entry; do not substitute a fake vendor codec.
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./plugin.ts", import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2020",
    legalComments: "none",
  });
  source = result.outputFiles[0]?.text ?? "";
  expect(source).not.toBe("");
});

function approved(entrySource = source): StoredPlugin {
  const manifest = pluginManifestSchema.parse(yaskawaMemobusManifest);
  return {
    manifest,
    entrySource,
    enabled: true,
    executionMode: "same-process",
    approval: {
      version: 1,
      contentDigest: createHash("sha256")
        .update(pluginApprovalContent(manifest, entrySource, "same-process"))
        .digest("hex"),
      permissions: [...manifest.permissions],
    },
  };
}

function setup(record = approved()) {
  let data: PluginStoreData = { schemaVersion: 6, plugins: [record] };
  const store: PluginStorePort = {
    load: async () => ok(data),
    save: async (next) => {
      data = next;
      return ok(undefined);
    },
  };
  const codecs = createCodecRegistry();
  registerBasicTablesCodecs(codecs);
  const coreIds = codecs.list();
  const runtime = createHostPluginRuntime({ store, codecRegistry: codecs });
  const clock = new VirtualClock();
  const transport = new FakeTransport();
  const session = () =>
    new CommunicationSession({
      transport,
      clock,
      config: {
        ...createDefaultRtuProfile(),
        requestTimeoutMs: 1000,
        retryCount: 0,
      },
      protocol,
      codecRegistry: codecs,
    });
  return { store, codecs, coreIds, runtime, clock, transport, session };
}

async function advanceUntil(clock: VirtualClock, ready: () => boolean) {
  for (let step = 0; step < 400 && !ready(); step += 1) {
    clock.advance(5);
    await Promise.resolve();
    await Promise.resolve();
  }
  expect(ready()).toBe(true);
}

describe("MEMOBUS distributable in the Electron/VSCode host runtime", () => {
  it("projects only current host capabilities and restores local RTU contributions", async () => {
    const points = new ContributionPointRegistry();
    for (const point of BUILTIN_CONTRIBUTION_POINTS)
      points.registerPoint(point);
    const renderer = new PluginRegistry({ contributionRegistry: points });
    const record = approved();
    const fixture = setup(record);
    const register = (entry: StoredPlugin) => {
      if (entry.entrySource === undefined || entry.approval === undefined)
        throw new Error("Approved vendor source missing");
      expect(
        renderer.register(entry.manifest, {
          source: "installed",
          entrySource: entry.entrySource,
          executionMode: "same-process",
          approval: entry.approval,
        }).ok,
      ).toBe(true);
    };
    const tableIds = () =>
      renderer.getContributions("tableType").map((item) => item.pluginId);
    try {
      register(record);
      expect(tableIds()).toEqual([protocol]);
      renderer.configureHostContributions(true);
      expect(tableIds()).toEqual([]);
      await fixture.runtime.sync();
      const first = fixture.runtime.getSnapshot();
      renderer.applyHostSnapshot(first);
      expect(tableIds()).toEqual([protocol]);
      renderer.markHostPluginPending(protocol);
      expect(tableIds()).toEqual([]);
      renderer.completeHostPluginSync();
      expect(tableIds()).toEqual([protocol]);

      await fixture.store.save({
        schemaVersion: 6,
        plugins: [{ ...record, enabled: false }],
      });
      await fixture.runtime.sync();
      renderer.applyHostSnapshot(fixture.runtime.getSnapshot());
      expect(tableIds()).toEqual([]);
      renderer.applyHostSnapshot(first);
      expect(tableIds()).toEqual([]);
      // Electron's local RTU path uses renderer contributions even when the host is disabled.
      renderer.configureHostContributions(false);
      expect(tableIds()).toEqual([protocol]);
      renderer.configureHostContributions(true);

      const replacement = approved(source + "\n// New approved source\n");
      expect(renderer.unregister(protocol).ok).toBe(true);
      register(replacement);
      expect(tableIds()).toEqual([]);
      await fixture.store.save({ schemaVersion: 6, plugins: [replacement] });
      await fixture.runtime.sync();
      renderer.applyHostSnapshot(fixture.runtime.getSnapshot());
      expect(tableIds()).toEqual([protocol]);
      expect(renderer.getHostState(protocol)?.contentDigest).toBe(
        replacement.approval?.contentDigest,
      );
    } finally {
      await renderer.dispose();
      fixture.runtime.dispose();
    }
  });
  it.each(["disable", "uninstall", "source"] as const)(
    "%s revokes in-flight and queued reads; a fresh session uses the restored codec",
    async (change) => {
      const record = approved();
      const fixture = setup(record);
      const { runtime, store, codecs, transport, clock } = fixture;
      await runtime.sync();
      const session = fixture.session();
      try {
        expect(runtime.getSnapshot().plugins[0]).toMatchObject({
          stage: "active",
          contributions: { protocolIds: [protocol] },
        });
        expect(transport.sentFrames).toHaveLength(0);
        await session.connect();
        const pending = session.readRegistersAt([0x24, 0x28], {
          source: "manual-read",
        });
        const queued = session.readRegistersAt([0x24, 0x28], {
          source: "manual-read",
        });
        await advanceUntil(clock, () => transport.sentFrames.length === 1);
        expect([...(transport.sentFrames[0] ?? [])]).toEqual(request);
        const oldLease = codecs.capture(protocol);
        const generation = runtime.getSnapshot().plugins[0]?.generation;
        const changed =
          change === "source"
            ? approved(source + "\n// Replacement generation\n")
            : { ...record, enabled: false };
        await store.save({
          schemaVersion: 6,
          plugins: change === "uninstall" ? [] : [changed],
        });
        await runtime.sync();
        expect(oldLease?.isCurrent()).toBe(false);
        expect(codecs.list()).toEqual(
          change === "source"
            ? [...fixture.coreIds, protocol]
            : fixture.coreIds,
        );
        if (change === "source")
          expect(runtime.getSnapshot().plugins[0]?.generation).not.toBe(
            generation,
          );
        if (change === "disable")
          expect(runtime.getSnapshot().plugins[0]).toMatchObject({
            stage: "disabled",
            contributions: { protocolIds: [] },
          });
        if (change === "uninstall")
          expect(runtime.getSnapshot().plugins).toEqual([]);

        // Late data cannot complete an old lease or release a queued request to the wire.
        transport.simulateData(Uint8Array.from(response));
        let settled = false;
        const results = Promise.all([pending, queued]).then((values) => {
          settled = true;
          return values;
        });
        await advanceUntil(clock, () => settled);
        for (const result of await results)
          expect(result).toMatchObject({
            ok: false,
            error: { code: "CANCELLED" },
          });
        expect(transport.sentFrames).toHaveLength(1);
        await session.disconnect();

        await store.save({ schemaVersion: 6, plugins: [record] });
        await runtime.sync();
        expect(oldLease?.isCurrent()).toBe(false);
        const fresh = fixture.session();
        try {
          await fresh.connect();
          const read = fresh.readRegistersAt([0x24, 0x28], {
            source: "manual-read",
          });
          await advanceUntil(clock, () => transport.sentFrames.length === 2);
          expect([...(transport.sentFrames[1] ?? [])]).toEqual(request);
          transport.simulateData(Uint8Array.from(response));
          expect(await read).toEqual(ok([0x1770, 0x03e8]));
        } finally {
          await fresh.disconnect();
        }
      } finally {
        await session.disconnect();
        runtime.dispose();
        expect(codecs.list()).toEqual(fixture.coreIds);
      }
    },
  );

  it("isolates a failed vendor source, rejects unchanged approval and restores approved source", async () => {
    const fixture = setup();
    const { runtime, store, codecs } = fixture;
    try {
      await runtime.sync();
      const old = codecs.capture(protocol);
      const brokenSource =
        source + '\nthrow new Error("Vendor module unavailable");';
      await store.save({
        schemaVersion: 6,
        plugins: [{ ...approved(), entrySource: brokenSource }],
      });
      await runtime.sync();
      expect(runtime.getSnapshot().plugins[0]?.stage).toBe("failed");
      expect(old?.isCurrent()).toBe(false);
      expect(codecs.list()).toEqual(fixture.coreIds);
      await store.save({ schemaVersion: 6, plugins: [approved(brokenSource)] });
      await runtime.sync();
      expect(runtime.getSnapshot().plugins[0]).toMatchObject({
        stage: "failed",
        contributions: { protocolIds: [] },
      });
      expect(codecs.list()).toEqual(fixture.coreIds);
      await store.save({ schemaVersion: 6, plugins: [approved()] });
      await runtime.sync();
      expect(runtime.getSnapshot().plugins[0]?.stage).toBe("active");
      expect(codecs.list()).toEqual([...fixture.coreIds, protocol]);
    } finally {
      runtime.dispose();
    }
  });

  it("rejects the RTU vendor codec on TCP before sending any request", async () => {
    const fixture = setup();
    try {
      await fixture.runtime.sync();
      expect(
        () =>
          new CommunicationSession({
            transport: fixture.transport,
            clock: fixture.clock,
            config: {
              ...createDefaultTcpProfile(),
              host: "127.0.0.1",
              retryCount: 0,
            },
            protocol,
            codecRegistry: fixture.codecs,
          }),
      ).toThrow(
        expect.objectContaining({ code: "REQUEST_ROUTE_PROTOCOL_MISMATCH" }),
      );
      expect(fixture.transport.sentFrames).toHaveLength(0);
    } finally {
      fixture.runtime.dispose();
    }
  });
});
