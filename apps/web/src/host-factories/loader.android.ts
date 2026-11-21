/** Android 生产构建的 Host 加载器（Vite mode 别名入口）。 */
import type { PlatformHostFactoryLoader } from "../host-assembly";
import { createBrowserHost } from "./browser";

export const loadPlatformHostFactory: PlatformHostFactoryLoader = async (
  platform,
) => {
  if (platform === "browser") return createBrowserHost;
  if (platform !== "android") {
    throw new Error(`Android build cannot load ${platform} host.`);
  }
  const module = await import("./android");
  return module.createAndroidHost;
};
