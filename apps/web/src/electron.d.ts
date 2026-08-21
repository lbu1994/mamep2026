import type { MamepHostApi } from "@mamep2026/platform-api";

declare global {
  interface Window {
    /** Electron preload 经 contextBridge 暴露的白名单桥；仅 Electron renderer 存在。 */
    mamepHost?: MamepHostApi;
  }
}

export {};
