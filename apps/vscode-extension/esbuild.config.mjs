/**
 * VSCode 扩展构建（esbuild，docs/TECH_DESIGN.md §6.3）。
 * - extension host：src/extension.ts → dist/extension.js（Node CJS，external vscode，
 *   内联 @mamep2026/platform-api / @mamep2026/domain 共享包源码——共享包 exports 指向
 *   TS 源码，纯 tsc 无法打包，必须经 bundler 内联）。
 * - webview bridge：src/webview/vscode-bridge.ts → dist/media/vscode-bridge.js
 *   （browser IIFE，随共享 UI 静态资源一起打包进扩展，Webview 生产模式经 asWebviewUri 加载）。
 */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.resolve(ROOT, "apps/vscode-extension/src");
const DIST = path.resolve(ROOT, "apps/vscode-extension/dist");

/** 打包扩展宿主（Extension Host 侧，Node 运行时）。 */
export async function buildExtensionBundle() {
  await build({
    entryPoints: [path.join(SRC, "extension.ts")],
    outfile: path.join(DIST, "extension.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    // vscode 模块由 VSCode 扩展宿主在运行时提供，不打进 bundle。
    // serialport 为原生绑定模块（@serialport/bindings-cpp），必须 external，由扩展
    // 运行时从 node_modules 加载（ADR-020：Node Serial Adapter 注入面隔离库类型）。
    external: ["vscode", "serialport", "@serialport/*"],
    sourcemap: true,
    logLevel: "info",
  });
}

/** 打包 Webview 侧消息桥（browser IIFE，设置 window.mamepHost）。 */
export async function buildBridgeBundle() {
  await build({
    entryPoints: [path.join(SRC, "webview", "vscode-bridge.ts")],
    outfile: path.join(DIST, "media", "vscode-bridge.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    // VSCode Webview 基于 Electron Chromium（^1.85 对应 Chromium 114+），es2022 目标足够。
    target: "chrome114",
    sourcemap: false,
    logLevel: "info",
  });
}

// 直接执行（node esbuild.config.mjs）时构建两个 bundle。
const isDirect =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  await buildExtensionBundle();
  await buildBridgeBundle();
}
