/**
 * 浏览器 Host 工厂（2026-09-13）。
 *
 * **静态装配**：`BrowserAppHost` 同时是 Electron / Android 宿主的 inner（三端共用浏览器路径：
 * Web Serial + IndexedDB），故本工厂不做动态 `import()`（避免所有平台首屏多一次异步跳）。
 * 浏览器平台标识（`AppHost.platform === "browser"`）由 `BrowserAppHost` 自身给出。
 */
import {
  BrowserPlatformHost,
  IndexedDBWorkspaceRepository,
} from "@mamep2026/platform-web";
import { BrowserAppHost } from "../AppHost";
import type { PlatformHostFactory } from "../host-assembly";
import { IndexedDBPluginStore } from "../indexeddb-plugin-store";

export const createBrowserHost: PlatformHostFactory = ({ context }) => {
  const serial = navigator.serial;
  const platformHost =
    serial !== undefined
      ? new BrowserPlatformHost({ serial })
      : new BrowserPlatformHost({});
  // 工作区与插件存储共享同一 IndexedDB KV（不同 key：workspace / plugins）。
  const kv = context.createIdbKeyValueStore();
  return new BrowserAppHost({
    platform: platformHost,
    // 浏览器兼容性检测（PRD §8.3 / §15.7）：输入由组合根计算（含 ?compatMiss=1 强制缺失）。
    compatibilityEnv: context.compatibilityEnv,
    repository: new IndexedDBWorkspaceRepository(kv),
    mockTransport: context.mockTransport,
    // 插件持久化（2026-08-30，ADR-038）：IndexedDB 独立 key。
    pluginStore: new IndexedDBPluginStore(kv),
    // codec 注册表（ADR-041 决策 A）。
    codecRegistry: context.codecRegistry,
    // 插件同步贡献注册面 + 地址变换解析（ADR-054）。
    syncRegistries: context.syncRegistries,
    resolveAddressTransform: context.resolveAddressTransform,
  });
};
