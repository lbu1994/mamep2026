/**
 * 插件权限模型（docs/插件功能设计.md §6，ADR-039）。
 * Manifest v2 将 permissions 从自由 string[] 收敛为类型化枚举；未知权限直接拒绝安装。
 * 权限到消费能力的强制在 PluginCommunicationApi 落地（communication 权限门）。
 */
import { z } from "zod";
import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";

/** 类型化权限枚举（ADR-039）。新权限 = 追加枚举 + 标签映射 + 消费方强制，不破坏存量插件。 */
export const PERMISSION_IDS = [
  "communication",
  "device-write",
  "workspace-read",
  "workspace-write",
  "file-read",
  "file-write",
  "network",
  "ui-contribution",
  "theme",
] as const;

export type PermissionId = (typeof PERMISSION_IDS)[number];

export const permissionIdSchema = z.enum(PERMISSION_IDS);

/** 权限 → i18n 文案键映射（UI 权限 Tag 使用；键定义于 ui i18n `plugins.permission.*`）。 */
export const PERMISSION_LABEL_KEYS: Record<PermissionId, string> = {
  communication: "plugins.permission.communication",
  "device-write": "plugins.permission.deviceWrite",
  "workspace-read": "plugins.permission.workspaceRead",
  "workspace-write": "plugins.permission.workspaceWrite",
  "file-read": "plugins.permission.fileRead",
  "file-write": "plugins.permission.fileWrite",
  network: "plugins.permission.network",
  "ui-contribution": "plugins.permission.uiContribution",
  theme: "plugins.permission.theme",
};

export const PLUGIN_PERMISSION_DENIED = "PLUGIN_PERMISSION_DENIED";

/** 校验权限声明：非数组 / 含未知权限 → PLUGIN_PERMISSION_DENIED。 */
export function validatePermissions(permissions: unknown): Result<PermissionId[]> {
  const parsed = z.array(permissionIdSchema).safeParse(permissions);
  if (!parsed.success) {
    return fail(
      createMamepError({
        code: PLUGIN_PERMISSION_DENIED,
        category: "plugin",
        userMessageKey: "errors.pluginPermissionDenied",
        technicalMessage: parsed.error.message,
      }),
    );
  }
  return ok(parsed.data);
}

/**
 * 迁移用：从旧自由 string[] 中筛出合法权限（非法项丢弃，不阻断 store v1→v2 迁移）。
 */
export function normalizePermissions(permissions: unknown): PermissionId[] {
  if (!Array.isArray(permissions)) return [];
  return permissions.filter(
    (p): p is PermissionId => permissionIdSchema.safeParse(p).success,
  );
}
