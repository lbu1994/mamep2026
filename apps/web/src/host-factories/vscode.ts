/**
 * VSCode Webview Host 工厂（2026-09-13；本模块只在 VSCode 平台被动态 `import()`）。
 *
 * 边界：只做装配——工作区/剪贴板/插件注册表复用浏览器路径、通信经 HostMessage v2 RPC 到
 * Extension Host 等实现细节仍在 `VscodeAppHost` 内。dev 桥（`vscode-dev-bridge.ts`）在
 * `main.tsx` 中先于渲染同步安装，因此此处读到桥必然已就绪。
 */
import { VscodeAppHost } from "../vscode-app-host";
import type { PlatformHostFactory } from "../host-assembly";

export const createVscodeHost: PlatformHostFactory = ({ context, bridge }) => {
  if (bridge === undefined || bridge.platform !== "vscode") {
    throw new Error("VscodeAppHost requires the VSCode webview bridge.");
  }
  return new VscodeAppHost(bridge, {
    syncRegistries: context.syncRegistries,
    resolveAddressTransform: context.resolveAddressTransform,
  });
};
