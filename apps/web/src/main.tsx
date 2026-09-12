import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initI18n, useAppStore } from "@mamep2026/ui";
import "./index.css";
// 移动布局（< 1024px，ADR-050 Phase 3）：桌面媒体查询内不生效。
import "./mobile.css";
import App from "./App.tsx";
import { installVscodeDevBridgeIfNeeded } from "./vscode-dev-bridge";

initI18n();
// dev（MAMEP_DEV_URL）：webview iframe 内先建立 window.mamepHost（postMessage 桥），
// 保证 App 装配时读到 VscodeAppHost。生产/浏览器/Electron 无副作用。
installVscodeDevBridgeIfNeeded();
// 启动骨架（2026-09-13）：宿主实现按运行时平台动态加载，先标记「装配中」让 MamepApp 显示占位。
// 起点必须**早于首次渲染**（故在此内联，而非 App 内 effect）；终态由 host-assembly 改写
// （成功 "ready" / 失败 "failed"），失败时不占位、应用以「无 Host」保持可操作。
useAppStore.setState({ hostStatus: "assembling" });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
