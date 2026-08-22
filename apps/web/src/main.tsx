import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initI18n } from "@mamep2026/ui";
import "./index.css";
import App from "./App.tsx";
import { installVscodeDevBridgeIfNeeded } from "./vscode-dev-bridge";

initI18n();
// dev（MAMEP_DEV_URL）：webview iframe 内先建立 window.mamepHost（postMessage 桥），
// 保证 App 装配时读到 VscodeAppHost。生产/浏览器/Electron 无副作用。
installVscodeDevBridgeIfNeeded();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
