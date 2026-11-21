/**
 * 开发 / 测试用 Host 加载器：按运行时探测结果动态加载目标平台工厂。
 *
 * 生产构建由 `vite.config.ts` 把该模块别名到 `loader.<target>.ts`，目标入口只引用
 * 共享浏览器 Host 与自身平台工厂，避免其他平台 API 进入产物。
 */
import type {
  PlatformHostFactory,
  PlatformHostFactoryLoader,
} from "../host-assembly";
import type { AppPlatformName } from "../platform-detect";
import { createBrowserHost } from "./browser";

async function loadRuntimeDetectedHostFactory(
  platform: AppPlatformName,
): Promise<PlatformHostFactory> {
  switch (platform) {
    case "browser":
      // 三端 inner 同源（BrowserAppHost 也是 Electron/Android 的 inner），无收益且会引入额外异步跳。
      return createBrowserHost;
    case "electron": {
      const module = await import("./electron");
      return module.createElectronHost;
    }
    case "vscode": {
      const module = await import("./vscode");
      return module.createVscodeHost;
    }
    case "android": {
      const module = await import("./android");
      return module.createAndroidHost;
    }
    default:
      // 穷尽守卫：平台联合类型新增分支时必须在此显式处理（不得静默回退浏览器路径）。
      throw new Error(`Unsupported platform: ${String(platform)}`);
  }
}

export const loadPlatformHostFactory: PlatformHostFactoryLoader =
  loadRuntimeDetectedHostFactory;
