/**
 * 插件 Manifest v2（docs/architecture/ports/plugin-api/插件契约.md §3；基线 docs/TECH_DESIGN.md §6.11、
 * docs/AGENTS.md §24）。
 * - `apiVersion`：插件 API 版本（compatibility 判定依据，语义化 major.minor）；
 * - `entry`：可执行入口模块路径，由隔离运行时加载；
 * - `requiredCapabilities`：平台能力要求（如 ["modbus-rtu"]）；
 * - `contributions`：`Record<ContributionPointId, unknown>`，key = 贡献点
 *   ID，value = 该点 payload（单对象或数组，按贡献点 schema 校验）；
 * - `permissions`：类型化 PermissionId[]。
 */
import { z } from "zod";
import { PERMISSION_IDS } from "./permissions";

/**
 * 当前插件 API 版本（Manifest v2）。破坏性契约变更时递增 major。
 * 插件由用户手动安装；插件上下文提供同步贡献面 `ctx.registries`
 * （codec/dataType/addressTransform 注册）。major 不兼容时禁止加载。
 */
export const PLUGIN_API_VERSION = "2.0" as const;

/** Versioned execution requirements describe the runtime; they never grant consent. */
export const pluginExecutionRequirementsSchema = z
  .object({
    version: z.literal(1),
    requiredExecution: z.enum(["isolated", "same-process"]),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export const pluginManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  apiVersion: z.string().min(1),
  description: z.string(),
  author: z.string().optional(),
  license: z.string().optional(),
  executionRequirements: pluginExecutionRequirementsSchema.optional(),
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

/** Legacy manifests without requirements use isolation and cannot request escalation. */
export function getRequiredPluginExecution(
  manifest: PluginManifest,
): "isolated" | "same-process" {
  return manifest.executionRequirements?.requiredExecution ?? "isolated";
}
