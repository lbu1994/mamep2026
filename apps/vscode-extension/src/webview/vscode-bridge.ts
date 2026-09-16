/**
 * VSCode Webview 侧消息桥（生产路径；docs/TECH_DESIGN.md §6.3、§22.2、docs/AGENTS.md §23）。
 * 桥实现（createVscodeBridge + VsCodeApi）已下沉到 @mamep2026/platform-api（协议层共享，
 * dev 模式 iframe 内复用同一实现——apps/web/src/vscode-dev-bridge.ts），本文件仅：
 *  1. 复导出（保持旧 import 路径兼容，含单测）；
 *  2. 顶层装配：vscode-bridge.js 在 Webview 主 frame 作为经典脚本注入时，同步执行
 *     acquireVsCodeApi()（仅在 Webview 主 frame 可用）并设置 window.mamepHost，
 *     先于共享 UI 的 module script 就绪。
 */
import { createVscodeBridge, type VsCodeApi } from "@mamep2026/platform-api";

export { createVscodeBridge };
export type { VsCodeApi };

/** Webview 全局（由 VSCode 注入，非 Node 环境；此处仅声明类型）。 */
declare function acquireVsCodeApi(): VsCodeApi;

declare global {
  interface Window {
    /** VSCode Webview 桥（vscode-bridge.js 设置；App.tsx 据此分支装配 VscodeAppHost）。 */
    mamepHost?: ReturnType<typeof createVscodeBridge>;
  }
}

// 顶层：Webview 中执行时暴露 window.mamepHost（vscode-bridge.js 由扩展在 module script
// 之前注入的经典脚本，同步执行，先于共享 UI 就绪）。
if (typeof window !== "undefined" && typeof acquireVsCodeApi === "function") {
  window.mamepHost = createVscodeBridge(acquireVsCodeApi(), window);
}
