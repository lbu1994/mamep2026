/**
 * VSCode 端构建编排（根 build:vscode）：
 *   1) 构建共享 UI 的 vscode 产物（apps/web/dist-vscode，vite --mode vscode，
 *      base "./" + 构建期 CSP meta，含 style-src 'unsafe-inline'）；
 *   2) 拷贝到扩展媒体目录 apps/vscode-extension/dist/media/
 *      （Webview 生产模式经 webview.asWebviewUri() 加载本地静态资源）；
 *   3) esbuild 打包扩展宿主（dist/extension.js）与 webview bridge（dist/media/vscode-bridge.js）。
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBridgeBundle,
  buildExtensionBundle,
} from "../apps/vscode-extension/esbuild.config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIST_VSCODE = path.resolve(ROOT, "apps/web/dist-vscode");
const EXT_MEDIA = path.resolve(ROOT, "apps/vscode-extension/dist/media");

console.log("[build:vscode] step 1/3: build shared UI (vite --mode vscode)");
execSync("pnpm --filter @mamep2026/web build:vscode", {
  cwd: ROOT,
  stdio: "inherit",
});

console.log("[build:vscode] step 2/3: copy UI build into extension media");
rmSync(EXT_MEDIA, { recursive: true, force: true });
mkdirSync(EXT_MEDIA, { recursive: true });
cpSync(WEB_DIST_VSCODE, EXT_MEDIA, { recursive: true });

console.log("[build:vscode] step 3/3: bundle extension host + webview bridge");
await buildExtensionBundle();
await buildBridgeBundle();

console.log("[build:vscode] done -> apps/vscode-extension/dist");
