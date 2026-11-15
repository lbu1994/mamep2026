/**
 * Android 平台探测：把「Capacitor 的存在形式」这类平台知识限制在 `packages/platform-android`。
 *
 * 仅读 `globalThis.Capacitor.getPlatform()`（由原生 native-bridge 注入），**不调用任何插件**——
 * 插件调用只允许出现在本包与 `apps/android`（docs/AGENTS.md §32 第 35 条）。
 */
interface CapacitorGlobalLike {
  getPlatform?: () => string;
}

/** 是否运行在 Android（Capacitor 容器）中。浏览器 / Electron / VSCode 均为 false。 */
export function isAndroidPlatform(globalObject: unknown = globalThis): boolean {
  const capacitor = (globalObject as { Capacitor?: CapacitorGlobalLike })
    ?.Capacitor;
  if (typeof capacitor?.getPlatform !== "function") return false;
  try {
    return capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}
