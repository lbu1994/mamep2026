/**
 * Electron Host 工厂（2026-09-13；本模块只在 Electron 平台被动态 `import()`）。
 *
 * 边界：只做装配（把组合根上下文 + preload 桥交给 `ElectronAppHost`）——RTU 复用 Web Serial
 * 路径、TCP 走主进程远程会话等实现细节仍在 `ElectronAppHost` 内。
 */
import { ElectronAppHost } from "../electron-app-host";
import type { PlatformHostFactory } from "../host-assembly";

export const createElectronHost: PlatformHostFactory = ({
  context,
  bridge,
}) => {
  if (bridge === undefined || bridge.platform === "vscode") {
    throw new Error("ElectronAppHost requires the Electron preload bridge.");
  }
  return new ElectronAppHost(bridge, {
    codecRegistry: context.codecRegistry,
    syncRegistries: context.syncRegistries,
    resolveAddressTransform: context.resolveAddressTransform,
  });
};
