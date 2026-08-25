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
 * 主题颜色中继（2026-08-25，ADR-027）：CSS 变量不跨 iframe 文档，dev 下共享 UI 读不到
 * --vscode-*。installVscodeDevThemeRelay 把主 frame 下发的 {source:"mamep-theme-relay",
 * type:"theme-colors", colors} 物化到 iframe 文档根（documentElement.style.setProperty），
 * 之后应用与生产走同一读取路径（readVscodeCssVars）。安装时向主 frame 发
 * theme-colors-request，闭合「主 frame 先跑、本桥后装」竞态。
 *
 * 仅 dev（import.meta.env.DEV）+ 显式查询参数 + iframe 上下文门控；浏览器/Electron 生产
 * 构建不生效。
 */
import {
  createVscodeBridge,
  type BridgeMessageEvent,
  type BridgeMessageTarget,
  type VsCodeApi,
} from "@mamep2026/platform-api";
import { VSCODE_CSS_VAR_NAMES } from "@mamep2026/ui-theme";

/** iframe URL 上的启用标记（webview/html.ts 的 iframe src 附带）。 */
export const VSCODE_IFRAME_FLAG = "mamepVscode";
/** 主题颜色中继消息源/类型（与 webview/html.ts 中继脚本一致，非 HostMessage Envelope）。 */
export const THEME_RELAY_SOURCE = "mamep-theme-relay";
export const THEME_RELAY_COLORS_TYPE = "theme-colors";
export const THEME_RELAY_REQUEST_TYPE = "theme-colors-request";

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

export interface VscodeDevThemeRelayEnvironment {
  search: string;
  isIframe: () => boolean;
  postToParent: (message: unknown) => void;
  targetWindow: BridgeMessageTarget;
  /** iframe 文档根样式（document.documentElement.style），用于物化 --vscode-* 变量。 */
  docStyle: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
  /** 需要物化的 --vscode-* 变量清单（与 ui-theme VSCODE_CSS_VAR_NAMES 同源）。 */
  varNames: readonly string[];
}

/** 收到的主题颜色中继消息形状。 */
interface ThemeColorsRelayMessage {
  source?: string;
  type?: string;
  colors?: Record<string, string>;
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

/**
 * 安装 dev 主题颜色中继（dev + iframe 门控）。返回是否已安装。
 * 主 frame 下发 --vscode-* 变量 → 物化到 iframe 文档根，使应用与生产走同一读取路径。
 */
export function installVscodeDevThemeRelay(
  env: VscodeDevThemeRelayEnvironment,
): boolean {
  if (new URLSearchParams(env.search).get(VSCODE_IFRAME_FLAG) !== "1") {
    return false;
  }
  if (!env.isIframe()) return false;
  // 请求主 frame 立即下发当前主题颜色（闭合「主 frame 先跑、本桥后装」竞态）。
  env.postToParent({ source: THEME_RELAY_SOURCE, type: THEME_RELAY_REQUEST_TYPE });
  env.targetWindow.addEventListener("message", (event: BridgeMessageEvent) => {
    const data = event.data as ThemeColorsRelayMessage;
    if (
      data?.source !== THEME_RELAY_SOURCE ||
      data.type !== THEME_RELAY_COLORS_TYPE ||
      data.colors === undefined
    ) {
      return;
    }
    for (const name of env.varNames) {
      const value = data.colors[name];
      if (value !== undefined && value !== "") {
        env.docStyle.setProperty(name, value);
      } else {
        env.docStyle.removeProperty(name);
      }
    }
  });
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
  installVscodeDevThemeRelay({
    search: window.location.search,
    isIframe: () => window.self !== window.top,
    postToParent: (message) => window.parent.postMessage(message, "*"),
    targetWindow: window,
    docStyle: document.documentElement.style,
    varNames: VSCODE_CSS_VAR_NAMES,
  });
}
