import { z } from "zod";
import type { PluginManifest } from "./manifest";
import { PERMISSION_IDS } from "./permissions";
import type { PluginExecutionMode, StoredPlugin } from "./plugin-store";

export const pluginApprovalSchema = z
  .object({
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    permissions: z.array(z.enum(PERMISSION_IDS)),
  })
  .strict();
export type PluginApproval = z.infer<typeof pluginApprovalSchema>;
export type PluginContentHasher = (content: string) => Promise<string>;

/** Serialize normalized data with stable object key order; array order remains significant. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

/** Bind consent to the complete manifest, source bytes and execution mode. */
export function pluginApprovalContent(
  manifest: PluginManifest,
  entrySource?: string,
  executionMode?: PluginExecutionMode,
): string {
  return JSON.stringify(
    canonical({
      manifest,
      entrySource: entrySource ?? null,
      executionMode: executionMode ?? null,
    }),
  );
}

/** Called only by the host after installation confirmation. */
export async function createPluginApproval(
  plugin: Pick<StoredPlugin, "manifest" | "entrySource" | "executionMode">,
  hash: PluginContentHasher,
): Promise<PluginApproval> {
  return {
    contentDigest: await hash(
      pluginApprovalContent(
        plugin.manifest,
        plugin.entrySource,
        plugin.executionMode,
      ),
    ),
    permissions: [...plugin.manifest.permissions],
  };
}

/** A digest detects content changes; storage isolation protects the consent record itself. */
export async function matchesPluginApproval(
  plugin: StoredPlugin,
  hash: PluginContentHasher,
): Promise<boolean> {
  const approval = pluginApprovalSchema.safeParse(plugin.approval);
  if (!approval.success) return false;
  const expected = await createPluginApproval(plugin, hash);
  return (
    expected.contentDigest === approval.data.contentDigest &&
    JSON.stringify([...expected.permissions].sort()) ===
      JSON.stringify([...approval.data.permissions].sort())
  );
}
