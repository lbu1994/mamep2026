import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
// 显式带 .ts 扩展名：Vite 未来主版本默认 configLoader: 'native'（Node 原生类型剥离，
// 遵循 ESM 显式扩展名解析规则）下无扩展名相对导入不再支持。
import { buildWebCsp } from "./src/csp.ts";

// https://vite.dev/config/
// 默认模式（pnpm dev / pnpm build）只构建网页端；
// 使用 `--mode electron`（pnpm dev:electron / pnpm build:electron）时才接入 Electron 主进程。
const ROOT = path.resolve(import.meta.dirname, "../..");
const DIST_ELECTRON = path.join(ROOT, "dist-electron");
/** Electron 渲染器独立产物目录：与浏览器构建（base /）分开，避免互相覆盖。 */
const RENDERER_DIST = path.resolve(ROOT, "apps/web/dist-electron");
/** VSCode Webview 渲染器独立产物目录（VSCode 端骨架）：与浏览器/Electron 构建分开。 */
const RENDERER_DIST_VSCODE = path.resolve(ROOT, "apps/web/dist-vscode");
/** Android（Capacitor）渲染器独立产物目录：Capacitor 的 webDir 指向它。 */
const RENDERER_DIST_ANDROID = path.resolve(ROOT, "apps/web/dist-android");

/**
 * 生产构建向 index.html 注入 CSP meta（docs/TECH_DESIGN.md §22.1、§22.4）。
 * Electron 生产模式用 loadFile(file://) 加载页面，file:// 请求不经过 webRequest headers，
 * 因此 CSP 必须在 HTML 内声明；dev（vite）不注入以保 HMR。
 * 策略内容见 `src/csp.ts`（回归保护：`src/csp.test.ts`；含插件 Blob Worker 所需 worker-src）。
 */
function injectCspMeta(): Plugin {
  const csp = buildWebCsp();
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

/**
 * 代码分割（ToDoList「构建产物代码分割」）：四端渲染器共用本文件，一次生效
 * （浏览器 `dist/`、Electron `dist-electron/`、VSCode `dist-vscode/`、Android `dist-android/`）。
 *
 * **做法与结论：不自定义分包规则，用 rolldown 默认的 `codeSplitting`。**
 * 配合 `MamepApp` 的 `React.lazy` 懒加载，rolldown 会按「动态入口可达性」自动把产物切成
 * 31 个 chunk：入口 192 kB、最大 472 kB（四端构建均无 Vite `> 500 kB` 告警），
 * 且与懒加载配套（弹窗/抽屉各自的 chunk 独立交付）。
 *
 * ⚠️ 已实测的弯路（不得重走）：
 * - 自定义 `groups`（`react` / `antd` / `vendor` **加 `maxSize: 400 * 1024`**）会把
 *   **同一个 npm 包内部的循环依赖切到不同 chunk**，破坏模块初始化顺序 →
 *   Electron 生产构建整体白屏：`TypeError: Class extends value undefined is not a constructor or null`
 *   （出错点 `@ant-design/colors`：`Color` 基类与子类 `H` 被分到两个 chunk）。浏览器 dev
 *   不打包，e2e-web 跑了也发现不了（只有四端**生产构建**能暴露）。
 * - 改成「一个 npm 包一个 chunk」（`name` 函数）虽可运行，但 `antd` 单包即 **816 kB**，
 *   告警仍在；而 `antd` 再按目录/体积细分又会回到上面的循环依赖问题。
 * - 旧接口 `output.advancedChunks` 在 rolldown 1.x 已弃用（构建会打印弃用告警），
 *   对应非弃用形态是 `output.codeSplitting`。
 *
 * 因此：任何分包调整都必须用**产物级**手段验证（`pnpm build:electron` + Electron 启动看
 * 是否挂载 / `pnpm test:e2e:electron`、`pnpm test:e2e:vscode`），不能只看构建体积。
 *
 * 平台宿主懒加载：`src/App.tsx` 只负责「探测平台 → 交由 `host-assembly.ts`」，
 * 后者按平台**动态 `import()`** 平台宿主（`src/host-factories/{electron,vscode,android}.ts`；
 * 浏览器分支静态返回 `createBrowserHost`）。实测（浏览器构建）：入口 384.54 → 7.78 kB，
 * 首屏（入口 + `modulepreload`）1663.21 → 1630.45 kB（−2.0%）/ gzip −0.8%，
 * `@capacitor/core` 从「首屏预加载」变为「仅 Android 按需」。注意口径：**入口 chunk 变小
 * 不等于首屏变小**（应用代码会重分入共享 chunk），评估首屏必须算「入口 + modulepreload 合计」。
 */

export default defineConfig(({ mode }) => {
  const isElectron = mode === "electron";
  // VSCode Webview 模式：产物独立目录（apps/web/dist-vscode），base "./" 供 asWebviewUri 相对解析。
  const isVscode = mode === "vscode";
  // Android（Capacitor）模式：产物独立目录（apps/web/dist-android），base "./" 供 WebViewAssetLoader 加载。
  const isAndroid = mode === "android";
  const isPlatformBuild = isElectron || isVscode || isAndroid;
  // 应用版本号取自根 package.json（三端共用版本），经 __APP_VERSION__ 注入，dev/build 均生效。
  const rootPkg = JSON.parse(
    readFileSync(path.resolve(ROOT, "package.json"), "utf-8"),
  ) as { version: string };

  // 各模式渲染器产物目录（浏览器沿用 Vite 默认 dist/；exactOptionalPropertyTypes 下按条件展开）。
  const rendererOutDir = isElectron
    ? RENDERER_DIST
    : isVscode
      ? RENDERER_DIST_VSCODE
      : isAndroid
        ? RENDERER_DIST_ANDROID
        : undefined;

  return {
    define: {
      __APP_VERSION__: JSON.stringify(rootPkg.version),
    },
    // Electron 生产模式经 loadFile(file://)、VSCode Webview 经 asWebviewUri 加载：必须相对路径。
    base: isPlatformBuild ? "./" : "/",
    build: {
      // 各平台渲染器独立产物目录，与浏览器构建（base /）分开。
      ...(rendererOutDir === undefined
        ? {}
        : { outDir: rendererOutDir, emptyOutDir: true }),
      // 代码分割：不自定义 `codeSplitting.groups`（原因与实测踩坑见文件头注释）。
    },
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
