import { describe, expect, it } from "vitest";
import { createPluginApproval, matchesPluginApproval } from "./plugin-approval";
import { pluginManifestSchema } from "./manifest";
import { migratePluginStoreData, type StoredPlugin } from "./plugin-store";

const contents = new Map<string, string>();
const hash = async (content: string) => {
  const existing = contents.get(content);
  if (existing !== undefined) return existing;
  const digest = (contents.size + 1).toString(16).padStart(64, "0");
  contents.set(content, digest);
  return digest;
};
const manifest = pluginManifestSchema.parse({
  id: "consent",
  name: "Consent",
  description: "Consent test",
  version: "1.0.0",
  apiVersion: "2.0",
  platform: { web: true, node: true },
  permissions: ["communication"],
});
const record: StoredPlugin = {
  manifest,
  enabled: true,
  entrySource: "export const manifest = {};",
  executionMode: "isolated",
};

describe("content-bound plugin consent", () => {
  it("accepts only the approved manifest, source, mode and permission set", async () => {
    const approved = {
      ...record,
      approval: await createPluginApproval(record, hash),
    };
    expect(await matchesPluginApproval(approved, hash)).toBe(true);
    for (const changed of [
      { ...approved, entrySource: record.entrySource + "\n" },
      { ...approved, executionMode: "same-process" as const },
      { ...approved, manifest: { ...manifest, version: "1.0.1" } },
      {
        ...approved,
        manifest: {
          ...manifest,
          executionRequirements: {
            version: 1 as const,
            requiredExecution: "isolated" as const,
            reason: "Changed requirements",
          },
        },
      },
      {
        ...approved,
        manifest: {
          ...manifest,
          permissions: ["communication", "device-write"] as const,
        },
      },
      { ...approved, approval: { ...approved.approval, permissions: [] } },
    ]) {
      expect(
        await matchesPluginApproval(
          {
            ...changed,
            manifest: {
              ...changed.manifest,
              permissions: [...changed.manifest.permissions],
            },
          },
          hash,
        ),
      ).toBe(false);
    }
    expect(await matchesPluginApproval(record, hash)).toBe(false);
  });

  it("migrates v4 without deleting source or treating old permission declarations as consent", () => {
    const migrated = migratePluginStoreData({
      schemaVersion: 4,
      plugins: [record],
    });
    expect(migrated).toEqual({
      ok: true,
      value: { schemaVersion: 6, plugins: [{ ...record, enabled: false }] },
    });
  });

  it("round-trips approval in v6 and rejects future schema versions", async () => {
    const approved = {
      ...record,
      approval: await createPluginApproval(record, hash),
    };
    expect(
      migratePluginStoreData({ schemaVersion: 6, plugins: [approved] }),
    ).toEqual({ ok: true, value: { schemaVersion: 6, plugins: [approved] } });
    expect(
      migratePluginStoreData({ schemaVersion: 99, plugins: [approved] }).ok,
    ).toBe(false);
  });
});
