import { createMamepError, fail, type Result } from "@mamep2026/domain";
import type { PermissionId } from "./permissions";
import { PLUGIN_PERMISSION_DENIED } from "./permissions";

export type PluginOperation = "read" | "write";

/** Host-owned access to one runtime or command. Never pass this object to a plugin. */
export interface PluginAuthorization {
  check(operation: PluginOperation): Result<void>;
  onRevoke(listener: () => void): () => void;
}

/** Return a stable error without granting access to device or session information. */
export function pluginPermissionDenied(reason: string) {
  return createMamepError({
    code: PLUGIN_PERMISSION_DENIED,
    category: "plugin",
    userMessageKey: "errors.pluginPermissionDenied",
    technicalMessage: reason,
  });
}

/** Missing authorization always fails closed, including legacy callers. */
export const deniedPluginAuthorization: PluginAuthorization = {
  check: () => fail(pluginPermissionDenied("plugin has no approved runtime")),
  onRevoke: () => () => {},
};

/** Read requires communication; write additionally requires device-write. */
export function hasCommunicationPermission(
  permissions: readonly PermissionId[],
  operation: PluginOperation,
): boolean {
  return (
    permissions.includes("communication") &&
    (operation === "read" || permissions.includes("device-write"))
  );
}
