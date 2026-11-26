import { z } from "zod";

const address = z.number().int().min(0).max(65535);
const read = z
  .object({ address, quantity: z.number().int().min(1).max(125) })
  .strict();
const write = z
  .object({ address, values: z.array(address).min(1).max(123) })
  .strict();

/** Validate untrusted runtime messages before dispatch. Unknown operations never write. */
export const pluginWorkerEventSchema = z.union([
  z
    .object({
      version: z.literal(1),
      type: z.literal("pong"),
      id: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({
    version: z.literal(1),
    type: z.literal("ready"),
    manifest: z.unknown(),
  }),
  z.object({
    version: z.literal(1),
    type: z.enum(["load-error", "error"]),
    message: z.string(),
  }),
  z.object({
    version: z.literal(1),
    type: z.enum(["activated", "deactivated"]),
  }),
  z
    .object({
      version: z.literal(1),
      type: z.literal("communication-request"),
      id: z.number().int().nonnegative(),
      op: z.literal("read"),
      payload: z.object({ pluginId: z.string(), req: read }).strict(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      type: z.literal("communication-request"),
      id: z.number().int().nonnegative(),
      op: z.literal("write"),
      payload: z.object({ pluginId: z.string(), req: write }).strict(),
    })
    .strict(),
]);

export type PluginWorkerEvent = z.infer<typeof pluginWorkerEventSchema>;
