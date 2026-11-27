import { describe, expect, it } from "vitest";
import { getRequiredPluginExecution, pluginManifestSchema } from "./manifest";
import { createPluginApproval, matchesPluginApproval } from "./plugin-approval";
import { migratePluginStoreData, type StoredPlugin } from "./plugin-store";

const manifest = pluginManifestSchema.parse({
  id: "execution",
  name: "Execution",
  version: "1.0.0",
  apiVersion: "2.0",
  description: "Execution requirements",
  platform: { web: true, node: true },
});
const hash = async () => "a".repeat(64);

describe("declared plugin execution requirements", () => {
  it("defaults legacy manifests to isolation and rejects unknown versions and modes", () => {
    expect(getRequiredPluginExecution(manifest)).toBe("isolated");
    for (const executionRequirements of [
      { version: 2, requiredExecution: "same-process" },
      { version: 1, requiredExecution: "automatic" },
      { requiredExecution: "same-process" },
      { version: 1, requiredExecution: "same-process", reason: " " },
    ]) {
      expect(
        pluginManifestSchema.safeParse({ ...manifest, executionRequirements })
          .success,
      ).toBe(false);
    }
  });

  it("rejects a mismatched mode even with an otherwise valid approval digest", async () => {
    const record: StoredPlugin = {
      manifest,
      enabled: true,
      entrySource: "source",
      executionMode: "same-process",
    };
    const approval = await createPluginApproval(record, hash);
    expect(await matchesPluginApproval({ ...record, approval }, hash)).toBe(
      false,
    );
    const declared = {
      ...record,
      manifest: {
        ...manifest,
        executionRequirements: {
          version: 1 as const,
          requiredExecution: "same-process" as const,
        },
      },
    };
    expect(
      await matchesPluginApproval(
        { ...declared, approval: await createPluginApproval(declared, hash) },
        hash,
      ),
    ).toBe(true);
  });

  it.each([4, 5])(
    "retains v%s source but removes consent and disables executable records",
    async (schemaVersion) => {
      const executable: StoredPlugin = {
        manifest,
        enabled: true,
        entrySource: "source",
        executionMode: "isolated",
      };
      executable.approval = await createPluginApproval(executable, hash);
      const migrated = migratePluginStoreData({
        schemaVersion,
        plugins: [executable, { manifest, enabled: true }],
      });
      expect(migrated).toEqual({
        ok: true,
        value: {
          schemaVersion: 6,
          plugins: [
            {
              manifest,
              enabled: false,
              entrySource: "source",
              executionMode: "isolated",
            },
            { manifest, enabled: true },
          ],
        },
      });
    },
  );
});
