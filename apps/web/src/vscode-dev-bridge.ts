/**
 * VSCode dev 模式专用桥（MAMEP_DEV_URL，2026-08-23）。
 *
 * 场景：扩展 Webview 主 frame 的 dev HTML 以 <iframe src=".../?mamepVscode=1"> 加载本
 * dev server（Vite 自己的 index.html，渲染/HMR 一切正常）；主 frame 运行中继脚本
 * （apps/vscode-extension/src/webview/html.ts）在 iframe ↔ 扩展宿主之间转发 HostMessage
 * Envelope。本模块在 iframe 内把 window.parent.postMessage 封装成 VsCodeApi，复用
 * platform-api 的 createVscodeBridge 建立与生产完全一致的 window.mamepHost（HostMessage
 * v1 类型化 RPC）→ App.tsx 装配 VscodeAppHost，串口枚举走 serial-enumerate RPC。
 *
 * 仅 dev（import.meta.env.DEV）+ 显式查询参数 + iframe 上下文门控；浏览器/Electron 生产
 * 构建不生效。
 */
import {
  createVscodeBridge,
  type BridgeMessageTarget,
  type VsCodeApi,
} from "@mamep2026/platform-api";

/** iframe URL 上的启用标记（webview/html.ts 的 iframe src 附带）。 */
export const VSCODE_IFRAME_FLAG = "mamepVscode";

export interface VscodeDevBridgeEnvironment {
  /** 当前页面查询串（如 "?mamepVscode=1"）。 */
  search: string;
  /** 是否处于 iframe（非顶层）上下文。 */
  isIframe: () => boolean;
  /** 向父 frame（webview 主 frame 中继）发送消息。 */
  postToParent: (message: unknown) => void;
  /** 桥内 message 事件接收目标（iframe 的 window）。 */
  targetWindow: BridgeMessageTarget;
}

/**
 * 安装 dev 桥（可测：注入环境）。返回是否已安装。
 * 生产/浏览器/Electron 场景（无查询参数或非 iframe）返回 false，不改动 window。
 */
export function installVscodeDevBridge(
  env: VscodeDevBridgeEnvironment,
): boolean {
  if (new URLSearchParams(env.search).get(VSCODE_IFRAME_FLAG) !== "1") {
    return false;
  }
  if (!env.isIframe()) return false;
  const api: VsCodeApi = {
    postMessage: (message) => env.postToParent(message),
    getState: () => null,
    setState: () => undefined,
  };
  window.mamepHost = createVscodeBridge(api, env.targetWindow);
  return true;
}

/** 生产装配入口：满足门控条件时安装（main.tsx 在渲染前调用）。 */
export function installVscodeDevBridgeIfNeeded(): void {
  if (!import.meta.env.DEV) return;
  installVscodeDevBridge({
    search: window.location.search,
    isIframe: () => window.self !== window.top,
    postToParent: (message) => window.parent.postMessage(message, "*"),
    targetWindow: window,
  });
}
