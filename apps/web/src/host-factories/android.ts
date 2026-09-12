/**
 * Android（Capacitor）Host 工厂（2026-09-13；本模块只在 Android 平台被动态 `import()`）。
 *
 * **本模块是 `@capacitor/core` / `@capacitor/app` 的唯一加载边界**（经 `platform-android` 的
 * `/capacitor`、`/capacitor-app` 子路径）：浏览器 / Electron / VSCode 产物不再包含 Capacitor
 * （改前实测 `@capacitor/core` chunk 会被首屏 `modulepreload` 预加载）。
 *
 * 会话仍在 JS 内（`AndroidAppHost` 委托 `BrowserAppHost` + 本地 `TcpSessionHost`），传输桥由本
 * 工厂注入 —— 红线：Capacitor 插件调用只允许出现在 `packages/platform-android` 与 `apps/android`
 * （docs/AGENTS.md §32），故本文件只**调用** `platform-android` 的桥工厂。
 */
import type { AndroidAppLifecycleBridge } from "@mamep2026/platform-android";
import { createCapacitorTransportBridge } from "@mamep2026/platform-android/capacitor";
import { createCapacitorAppLifecycleBridge } from "@mamep2026/platform-android/capacitor-app";
import { IndexedDBWorkspaceRepository } from "@mamep2026/platform-web";
import { AndroidAppHost } from "../android-app-host";
import type { AppHost } from "@mamep2026/ui";
import type { PlatformHostFactory } from "../host-assembly";
import { IndexedDBPluginStore } from "../indexeddb-plugin-store";

export const createAndroidHost: PlatformHostFactory = ({ context, signal }) => {
  // 应用生命周期桥（ADR-050 Phase 3）：返回键（宿主）与前后台（下方订阅）共用同一实例。
  const appLifecycle = createCapacitorAppLifecycleBridge();
  // 工作区与插件存储复用浏览器 IndexedDB 路径（WebView 原生支持）。
  const kv = context.createIdbKeyValueStore();
  const host = new AndroidAppHost({
    bridge: createCapacitorTransportBridge(),
    appLifecycle,
    repository: new IndexedDBWorkspaceRepository(kv),
    pluginStore: new IndexedDBPluginStore(kv),
    codecRegistry: context.codecRegistry,
    syncRegistries: context.syncRegistries,
    resolveAddressTransform: context.resolveAddressTransform,
    mockTransport: context.mockTransport,
  });
  subscribeAppStateChange(host, appLifecycle, signal);
  return host;
};

/**
 * Android 前后台状态（`@capacitor/app`，ADR-050 Phase 3）：部分 OEM 上 WebView 的
 * visibilitychange 在进程被冻结时不可靠，故用原生 appStateChange 兜底。与 visibilitychange
 * 路径都调用幂等的 `setBackgroundSuspended`（重复调用为空操作），可安全并存。
 *
 * 退订挂在本平台装配的取消信号上：装配被取消（StrictMode 双挂载 / 卸载）时释放监听。
 */
function subscribeAppStateChange(
  host: AppHost,
  appLifecycle: AndroidAppLifecycleBridge,
  signal: AbortSignal,
): void {
  let unsubscribe: (() => void) | null = null;
  let disposed = false;
  signal.addEventListener(
    "abort",
    () => {
      disposed = true;
      unsubscribe?.();
      unsubscribe = null;
    },
    { once: true },
  );
  void appLifecycle
    .onAppStateChange((isActive) => {
      host.setBackgroundSuspended?.(!isActive);
    })
    .then((off) => {
      if (disposed) {
        off();
        return;
      }
      unsubscribe = off;
    })
    .catch(() => {
      // 桥不可用（插件未注册）：保持 visibilitychange 单路径，不阻断启动。
    });
}
