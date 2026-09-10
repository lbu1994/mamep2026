/**
 * Android WebView 全局（Capacitor 由原生 native-bridge 注入）。
 * 仅 e2e 断言需要（`getPlatform()` 判定平台）；生产代码的平台探测在
 * `packages/platform-android/src/detect-android.ts`（同一语义，避免各处重复声明）。
 */
declare global {
  interface Window {
    Capacitor?: {
      getPlatform?: () => string;
    };
  }
}

export {};
