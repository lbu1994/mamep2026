import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

// https://vite.dev/config/
// 默认模式（pnpm dev / pnpm build）只构建网页端；
// 使用 `--mode electron`（pnpm dev:electron / pnpm build:electron）时才接入 Electron 主进程。
const ROOT = path.resolve(import.meta.dirname, "../..");
const DIST_ELECTRON = path.join(ROOT, "dist-electron");
/** Electron 渲染器独立产物目录：与浏览器构建（base /）分开，避免互相覆盖（ADR-016）。 */
const RENDERER_DIST = path.resolve(ROOT, "apps/web/dist-electron");
/** VSCode Webview 渲染器独立产物目录（VSCode 端骨架，2026-08-23）：与浏览器/Electron 构建分开。 */
const RENDERER_DIST_VSCODE = path.resolve(ROOT, "apps/web/dist-vscode");

/**
 * 生产构建向 index.html 注入 CSP meta（docs/TECH_DESIGN.md §22.1、§22.4）。
 * Electron 生产模式用 loadFile(file://) 加载页面，file:// 请求不经过 webRequest headers，
 * 因此 CSP 必须在 HTML 内声明；dev（vite）不注入以保 HMR。
 */
function injectCspMeta(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    // antd CSS-in-JS 依赖内联 <style>，必须放行 unsafe-inline。
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
  ].join("; ");
  return {
    name: "mamep-inject-csp-meta",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const isElectron = mode === "electron";
  // VSCode Webview 模式：产物独立目录（apps/web/dist-vscode），base "./" 供 asWebviewUri 相对解析。
  const isVscode = mode === "vscode";
  const isPlatformBuild = isElectron || isVscode;
  // 应用版本号取自根 package.json（三端共用版本），经 __APP_VERSION__ 注入，dev/build 均生效。
  const rootPkg = JSON.parse(
    readFileSync(path.resolve(ROOT, "package.json"), "utf-8"),
  ) as { version: string };

  return {
    define: {
      __APP_VERSION__: JSON.stringify(rootPkg.version),
    },
    // Electron 生产模式经 loadFile(file://)、VSCode Webview 经 asWebviewUri 加载：必须相对路径。
    base: isPlatformBuild ? "./" : "/",
    // 各平台渲染器独立产物目录，与浏览器构建（base /）分开（exactOptionalPropertyTypes 下按条件展开）。
    ...(isElectron
      ? { build: { outDir: RENDERER_DIST, emptyOutDir: true } }
      : {}),
    ...(isVscode
      ? { build: { outDir: RENDERER_DIST_VSCODE, emptyOutDir: true } }
      : {}),
    plugins: [
      react(),
      injectCspMeta(),
      ...(isElectron
        ? [
            electron({
              main: {
                // 主进程源码在 apps/electron/src/main/，产物输出到根 dist-electron/（根 package.json main 指向）。
                entry: path.resolve(
                  import.meta.dirname,
                  "../../apps/electron/src/main/main.ts",
                ),
                // 插件自动拉起 Electron 时默认以 vite root（apps/web）为 cwd，但应用入口
                // 在仓库根 package.json main（dist-electron/main.js），会导致 Electron 报
                // "Unable to find Electron app at ...apps\web" 并退出，其退出又经插件
                // process.exit 把 vite 一起带崩（退出码 1）。
                // 显式以仓库根为 cwd 启动（等价 pnpm start:electron 的 `electron .`；
                // VITE_DEV_SERVER_URL 由插件注入本进程环境、子进程自动继承）。
                onstart: async ({ startup }) => {
                  await startup(["."], { cwd: ROOT });
                },
                vite: {
                  build: {
                    outDir: DIST_ELECTRON,
                  },
                },
              },
              preload: {
                input: path.resolve(
                  import.meta.dirname,
                  "../../apps/electron/src/preload/preload.ts",
                ),
                // 插件的首次启动实际由 preload 的 onstart 驱动（closeBundle 计数达到
                // 主+preload 总数后以最后一个 options 触发，simple API 默认给 preload
                // 装 defaultPreloadOnstart，会用默认 cwd=apps/web 启动而找不到应用）。
                // 与 main 一样显式以仓库根为 cwd 启动。
                onstart: async ({ startup }) => {
                  await startup(["."], { cwd: ROOT });
                },
                vite: {
                  build: {
                    outDir: DIST_ELECTRON,
                    rolldownOptions: {
                      output: {
                        // sandbox 开启时 preload 必须为 CJS，且以 .js 扩展名输出（Electron 用 require 加载）。
                        format: "cjs",
                        entryFileNames: "[name].js",
                        codeSplitting: false,
                      },
                    },
                  },
                },
              },
            }),
          ]
        : []),
    ],
  };
});
