import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
// 移动布局（< 1024px）：桌面媒体查询内不生效。
import "./mobile.css";
import App from "./App.tsx";
import {
  beginHostAssembly,
  hydrateBootPreferences,
  installPreferencesCache,
} from "./boot-preferences-hydrate";
import { installVscodeDevBridgeIfNeeded } from "./vscode-dev-bridge";
import { markStartup } from "./startup-performance";

markStartup("bootstrap");
// 工作区 Worker 与 React 启动骨架/Host 模块并行加载；它不依赖首帧偏好，
// 因而不等 React effect。预热失败不阻断后续恢复。
void import("@mamep2026/platform-web")
  .then(({ warmWorkspaceParser }) => warmWorkspaceParser())
  .catch(() => undefined);
// Host 装配链在 React effect 后使用；入口只发起动态 import，不执行装配，
// 让模块下载/求值与启动骨架初次渲染并行。
void import("./host-assembly").catch(() => undefined);
void import("./platform-context").catch(() => undefined);
void import("./store-sinks").catch(() => undefined);
// 完整 UI 在 Host 模块获得启动优先权后空闲预取；若主线程持续繁忙，250ms 上限
// 保证下载不会无限延期。实际 React 挂载仍由工作区就绪门控制。
const prefetchMamepApp = (): void => {
  void import("@mamep2026/ui/MamepApp").catch(() => undefined);
};
if (typeof requestIdleCallback === "function") {
  requestIdleCallback(prefetchMamepApp, { timeout: 250 });
} else {
  setTimeout(prefetchMamepApp, 50);
}
// 首屏偏好：偏好的事实源（工作区）由宿主仓储**异步**
// 加载，若等到 `setWorkspace` 才应用，首帧必是「明亮 + 默认语言」。这里用可同步读取的启动缓存
// 先把主题 / 主题色预设 / 语言落到 store、i18n 与 `<html>` 上——**必须早于首次渲染**。
hydrateBootPreferences();
// 偏好变化（主题 / 主题色 / 语言，含工作区加载、导入、重置）→ 写回首屏缓存（best-effort）。
installPreferencesCache();
// dev（MAMEP_DEV_URL）：webview iframe 内先建立 window.mamepHost（postMessage 桥），
// 保证 App 装配时读到 VscodeAppHost。生产/浏览器/Electron 无副作用。
installVscodeDevBridgeIfNeeded();
// 启动骨架：先标记「装配中」让 MamepApp 显示占位；终态由 host-assembly 改写。
beginHostAssembly();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
