/**
 * 运行时平台探测（composition root 专用）。
 *
 * 装配按平台分流前**必须先同步判定平台**（装配是首屏路径，不能依赖任何懒 chunk），因此本模块
 * 只依赖 `@mamep2026/platform-android` 的 `isAndroidPlatform`（纯读 `globalThis.Capacitor`，
 * 不调用任何插件）；平台宿主实现本身按平台动态 `import()`（见 `host-assembly.ts`）。
 *
 * 判定顺序对齐既有 `App.tsx` 行为：宿主白名单桥优先（Electron preload / VSCode bridge），
 * 无桥时才看 Capacitor —— 避免 Android 上误判宿主桥、或宿主内误判 Capacitor。
 */
import type { MamepHostApi, VscodeHostApi } from "@mamep2026/platform-api";
import { isAndroidPlatform } from "@mamep2026/platform-android";

/** 运行时平台标识（与 `AppHost.platform` 对齐）。 */
export type AppPlatformName = "browser" | "electron" | "vscode" | "android";

export interface AppPlatformDetectEnv {
  /** 宿主白名单桥（`window.mamepHost`）：Electron preload / VSCode webview bridge 暴露。 */
  bridge: MamepHostApi | VscodeHostApi | undefined;
  /** 全局对象（读 `Capacitor.getPlatform()`，不调用任何插件）。 */
  globalObject: unknown;
}

/**
 * 判定当前运行平台：
 * - 宿主桥存在 → `bridge.platform === "vscode"` 为 VSCode，否则 Electron；
 * - 无宿主桥且 Capacitor 报 android → Android；其余为浏览器。
 */
export function detectAppPlatform(env: AppPlatformDetectEnv): AppPlatformName {
  if (env.bridge !== undefined) {
    return env.bridge.platform === "vscode" ? "vscode" : "electron";
  }
  return isAndroidPlatform(env.globalObject) ? "android" : "browser";
}
