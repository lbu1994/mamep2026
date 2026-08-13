/**
 * 插件 Manifest Schema（docs/TECH_DESIGN.md §6.11、docs/AGENTS.md §24）。
 * 清单驱动的内置插件；MVP 不执行任意第三方 JavaScript。
 */
import { z } from "zod";

export const pluginManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string(),
  author: z.string().optional(),
  platform: z.object({
    web: z.boolean(),
    node: z.boolean(),
  }),
  permissions: z.array(z.string()),
  contributions: z.object({
    panels: z
      .array(
        z.object({
          id: z.string().min(1),
          titleKey: z.string().min(1),
        }),
      )
      .default([]),
  }),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
