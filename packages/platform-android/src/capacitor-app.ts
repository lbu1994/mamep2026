/**
 * `@capacitor/app` 生命周期桥。
 *
 * 单独子路径导出（`@mamep2026/platform-android/capacitor-app`）：只有 Android 装配才加载
 * `@capacitor/app`，浏览器 / Electron / VSCode 构建不引入该依赖。
 *
 * 职责边界：本文件只做「原生事件 → 平台无关回调」的搬运，**不含任何 UI 决策**——
 * 返回键的消费顺序（先关抽屉、再最小化）由 UI 层（`MamepApp`）通过 `AppHost.onHardwareBack`
 * 决定，最小化只作为未被消费时的兜底。这样 UI 层不接触 Capacitor 类型（仓库红线）。
 */
import { App } from "@capacitor/app";
import type { AndroidAppLifecycleBridge } from "./bridge";

/** 转发接口定义（消费方可从 `@mamep2026/platform-android/capacitor-app` 或主入口引用）。 */
export type { AndroidAppLifecycleBridge };

/** 创建真实生命周期桥（仅在 Android 装配中调用）。 */
export function createCapacitorAppLifecycleBridge(): AndroidAppLifecycleBridge {
  const bridge: AndroidAppLifecycleBridge = {
    async onBackButton(handler: () => boolean): Promise<() => void> {
      const handle = await App.addListener("backButton", () => {
        if (handler()) {
          return;
        }
        void App.minimizeApp().catch(() => {
          // 最小化失败（极少数 ROM 限制）不应中断返回键订阅；
          // 此时应用保持在前台，用户可再次按返回键或手动切后台。
        });
      });
      return () => {
        void handle.remove();
      };
    },

    async onAppStateChange(
      handler: (isActive: boolean) => void,
    ): Promise<() => void> {
      const handle = await App.addListener("appStateChange", ({ isActive }) => {
        handler(isActive);
      });
      return () => {
        void handle.remove();
      };
    },

    async minimizeApp(): Promise<void> {
      await App.minimizeApp();
    },
  };

  return bridge;
}
