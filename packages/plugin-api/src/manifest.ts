/**
 * 插件 Manifest v2（docs/插件功能设计.md §3.1、ADR-039；基线 docs/TECH_DESIGN.md §6.11、
 * docs/AGENTS.md §24）。
 * - `apiVersion`：插件 API 版本（compatibility 判定依据，语义化 major.minor）；
 * - `entry`：可执行入口模块路径（Phase A 不加载，Phase F 隔离机制落地后使用）；
 * - `requiredCapabilities`：平台能力要求（如 ["modbus-rtu"]）；
 * - `contributions`：固定 `panels` 改为 `Record<ContributionPointId, unknown>`——key = 贡献点
 *   ID，value = 该点 payload（单对象或数组，按贡献点 schema 校验）；
 * - `permissions`：自由 string[] 收敛为类型化 PermissionId[]。
 */
import { z } from "zod";
import { PERMISSION_IDS } from "./permissions";

/** 当前插件 API 版本（Manifest v2，ADR-039）。破坏性契约变更时递增 major。 */
export const PLUGIN_API_VERSION = "1.0" as const;

export const pluginManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  apiVersion: z.string().min(1),
  description: z.string(),
  author: z.string().optional(),
  license: z.string().optional(),
  entry: z
    .object({
      web: z.string().min(1).optional(),
      node: z.string().min(1).optional(),
    })
    .optional(),
  requiredCapabilities: z.array(z.string()).default([]),
  platform: z.object({
    web: z.boolean(),
    node: z.boolean(),
  }),
  permissions: z.array(z.enum(PERMISSION_IDS)).default([]),
  contributes: z.record(z.string(), z.unknown()).default({}),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
