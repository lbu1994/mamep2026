import { describe, expect, it } from "vitest";
import { PluginRegistry } from "./registry";
import { ContributionPointRegistry } from "./contributions";
import { BUILTIN_CONTRIBUTION_POINTS } from "./builtin-contribution-points";
import {
  hostPluginSnapshotSchema,
  type HostPluginSnapshot,
} from "./host-plugin-state";

function setup() {
  const contributions = new ContributionPointRegistry();
  for (const point of BUILTIN_CONTRIBUTION_POINTS)
    contributions.registerPoint(point);
  const registry = new PluginRegistry({ contributionRegistry: contributions });
  registry.register(
    {
      id: "vendor",
      name: "Vendor",
      version: "1.0.0",
      apiVersion: "2.0",
      description: "State fixture",
      platform: { web: true, node: true },
      permissions: [],
      contributes: {
        protocolExtension: { protocolId: "vendor-codec", titleKey: "Vendor" },
        tableType: {
          id: "registers",
          protocolId: "vendor-codec",
          titleKey: "Vendor",
        },
        addressTransform: { id: "vendor-address", protocol: "rtu" },
        dataType: { id: "local-type", titleKey: "Local" },
        panels: [{ id: "info", titleKey: "Info" }],
      },
    },
    { source: "installed" },
  );
  const snapshot: HostPluginSnapshot = {
    schemaVersion: 1,
    revision: 1,
    error: null,
    plugins: [
      {
        pluginId: "vendor",
        generation: 1,
        contentDigest: null,
        stage: "active",
        contributions: {
          protocolIds: ["vendor-codec"],
          dataTypeIds: [],
          addressTransformIds: ["vendor-address"],
        },
        errors: [],
      },
    ],
  };
  return { registry, snapshot };
}

describe("host contribution results", () => {
  it("keeps changed content unavailable while its save is still synchronizing", () => {
    const { registry, snapshot } = setup();
    registry.configureHostContributions(true);
    registry.applyHostSnapshot(snapshot);
    registry.markHostPluginPending("vendor");
    registry.applyHostSnapshot({ ...snapshot, revision: 2 });
    expect(registry.getHostState("vendor")?.stage).toBe("loading");
    expect(registry.getContributions("protocolExtension")).toEqual([]);
    registry.completeHostPluginSync();
    expect(registry.getContributions("protocolExtension")).toHaveLength(1);
  });
  it("filters remote protocols, tables and transforms while retaining renderer contributions", () => {
    const { registry, snapshot } = setup();
    registry.configureHostContributions(true);
    expect(registry.getContributions("protocolExtension")).toEqual([]);
    registry.applyHostSnapshot(snapshot);
    for (const point of [
      "protocolExtension",
      "tableType",
      "addressTransform",
      "panels",
      "dataType",
    ])
      expect(registry.getContributions(point)).toHaveLength(1);
    registry.applyHostSnapshot({
      ...snapshot,
      revision: 2,
      plugins: snapshot.plugins.map((plugin) => ({
        ...plugin,
        stage: "failed",
      })),
    });
    for (const point of ["protocolExtension", "tableType", "addressTransform"])
      expect(registry.getContributions(point)).toEqual([]);
    expect(registry.getContributions("panels")).toHaveLength(1);
    expect(registry.getContributions("dataType")).toHaveLength(1);
    registry.configureHostContributions(false);
    expect(registry.getContributions("protocolExtension")).toHaveLength(1);
  });

  it("rejects late, malformed and mismatched content results and clears removed states", () => {
    const { registry, snapshot } = setup();
    registry.configureHostContributions(true);
    registry.applyHostSnapshot({
      ...snapshot,
      revision: 3,
      plugins: snapshot.plugins.map((plugin) => ({
        ...plugin,
        stage: "failed",
      })),
    });
    registry.applyHostSnapshot(snapshot);
    registry.applyHostSnapshot({
      ...snapshot,
      revision: 10,
      schemaVersion: 99,
    });
    expect(registry.getHostState("vendor")?.stage).toBe("failed");
    registry.applyHostSnapshot({
      ...snapshot,
      revision: 4,
      plugins: snapshot.plugins.map((plugin) => ({
        ...plugin,
        contentDigest: "other-content",
      })),
    });
    expect(registry.getContributions("protocolExtension")).toEqual([]);
    registry.applyHostSnapshot({ ...snapshot, revision: 5 });
    expect(registry.getContributions("protocolExtension")).toHaveLength(1);
    registry.applyHostSnapshot({ ...snapshot, revision: 6, plugins: [] });
    expect(registry.getHostState("vendor")).toBeUndefined();
    expect(registry.getContributions("protocolExtension")).toEqual([]);
  });

  it("requires a registered codec even when activation succeeded and blocks store failures", () => {
    const { registry, snapshot } = setup();
    registry.configureHostContributions(true);
    registry.applyHostSnapshot({
      ...snapshot,
      plugins: snapshot.plugins.map((plugin) => ({
        ...plugin,
        contributions: { ...plugin.contributions, protocolIds: [] },
      })),
    });
    expect(registry.getContributions("protocolExtension")).toEqual([]);
    expect(registry.getContributions("tableType")).toEqual([]);
    registry.applyHostSnapshot({
      ...snapshot,
      revision: 2,
      error: { code: "STORE_FAILED", technicalMessage: "Read failed" },
    });
    expect(registry.getContributions("addressTransform")).toEqual([]);
    expect(
      hostPluginSnapshotSchema.safeParse({ ...snapshot, revision: -1 }).success,
    ).toBe(false);
  });
});
