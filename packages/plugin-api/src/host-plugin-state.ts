import { z } from "zod";

/** Serializable host execution results. No executable values or stored source cross this boundary. */
export const hostPluginStateSchema = z.object({
  pluginId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  contentDigest: z.string().nullable(),
  stage: z.enum([
    "loading",
    "activating",
    "active",
    "failed",
    "disabled",
    "unsupported",
  ]),
  contributions: z.object({
    protocolIds: z.array(z.string()),
    dataTypeIds: z.array(z.string()),
    addressTransformIds: z.array(z.string()),
  }),
  errors: z.array(z.object({ code: z.string(), technicalMessage: z.string() })),
});

/** Full replacement snapshots also serve as change events; revision rejects late responses. */
export const hostPluginSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  plugins: z.array(hostPluginStateSchema),
  error: z
    .object({ code: z.string(), technicalMessage: z.string() })
    .nullable(),
});

export type HostPluginState = z.infer<typeof hostPluginStateSchema>;
export type HostPluginSnapshot = z.infer<typeof hostPluginSnapshotSchema>;
