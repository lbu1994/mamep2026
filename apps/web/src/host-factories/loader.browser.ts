/** 浏览器生产构建的 Host 加载器（Vite mode 别名入口）。 */
import type { PlatformHostFactoryLoader } from "../host-assembly";
import { createBrowserHost } from "./browser";

export const loadPlatformHostFactory: PlatformHostFactoryLoader = async (
  platform,
) => {
  if (platform !== "browser") {
    throw new Error(`Browser build cannot load ${platform} host.`);
  }
  return createBrowserHost;
};
