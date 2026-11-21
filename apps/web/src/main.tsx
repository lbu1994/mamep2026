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
