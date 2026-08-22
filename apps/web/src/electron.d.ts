import type { MamepHostApi, VscodeHostApi } from "@mamep2026/platform-api";

declare global {
  interface Window {
    /**
     * 宿主白名单桥：Electron preload（MamepHostApi）或 VSCode Webview bridge
     * （VscodeHostApi，vscode-bridge.js 设置）暴露；仅宿主 renderer 存在。
     * App.tsx 按 platform 判别联合窄化分支装配（ElectronAppHost / VscodeAppHost）。
     */
    mamepHost?: MamepHostApi | VscodeHostApi;
  }
}

export {};
