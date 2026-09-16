/**
 * 插件 API 版本兼容性判定（docs/插件功能设计.md §3.1，ADR-039）。
 * apiVersion 采用语义化 major.minor：major 不同 → 禁止加载（forbidden）；minor 不同 →
 * 可加载但警告（loadable-warning）。破坏性变更提升 major 并递增 PLUGIN_API_VERSION。
 */
import { createMamepError } from "@mamep2026/domain";
import { PLUGIN_API_VERSION } from "./manifest";

export type CompatibilityVerdict =
  "loadable" | "loadable-warning" | "forbidden";

export interface CompatibilityResult {
  verdict: CompatibilityVerdict;
  /** 非 loadable 时的原因（warning 展示用，forbidden 记录用）。 */
  reason?: string;
}

export const PLUGIN_VERSION_INCOMPATIBLE = "PLUGIN_VERSION_INCOMPATIBLE";

export function checkCompatibility(apiVersion: string): CompatibilityResult {
  if (apiVersion === PLUGIN_API_VERSION) return { verdict: "loadable" };
  const expected = splitVersion(PLUGIN_API_VERSION);
  const actual = splitVersion(apiVersion);
  if (actual.major !== expected.major) {
    return {
      verdict: "forbidden",
      reason: `plugin apiVersion ${apiVersion} is incompatible with host ${PLUGIN_API_VERSION}`,
    };
  }
  return {
    verdict: "loadable-warning",
    reason: `plugin apiVersion ${apiVersion} differs from host ${PLUGIN_API_VERSION}`,
  };
}

function splitVersion(version: string): { major: number; minor: number } {
  const [major = "0", minor = "0"] = version.split(".", 2);
  const parsedMajor = Number.parseInt(major, 10);
  const parsedMinor = Number.parseInt(minor, 10);
  return {
    major: Number.isNaN(parsedMajor) ? 0 : parsedMajor,
    minor: Number.isNaN(parsedMinor) ? 0 : parsedMinor,
  };
}

export function incompatibleError(
  pluginId: string,
  reason: string,
): ReturnType<typeof createMamepError> {
  return createMamepError({
    code: PLUGIN_VERSION_INCOMPATIBLE,
    category: "plugin",
    userMessageKey: "errors.pluginVersionIncompatible",
    technicalMessage: `plugin ${pluginId}: ${reason}`,
  });
}
