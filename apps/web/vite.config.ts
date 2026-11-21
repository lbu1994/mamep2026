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

type BuildTarget = "auto" | "browser" | "electron" | "vscode" | "android";
type PlatformFactoryName = Exclude<BuildTarget, "auto">;

/**
 * 生产产物只能包含共享浏览器工厂与当前目标平台工厂。开发服务器仍使用 `auto`
 * 以便 VSCode iframe / Electron 在同一个 dev server 中按运行时桥探测。
 */
function enforcePlatformHostBuildBoundary(
  target: PlatformFactoryName,
): Plugin {
  const expectedFactories = new Set<PlatformFactoryName>(["browser"]);
  if (target !== "browser") expectedFactories.add(target);
  const platformHostImplementations = new Map<
    PlatformFactoryName,
    readonly string[]
  >([
    ["browser", ["/apps/web/src/AppHost.ts"]],
    ["electron", ["/apps/web/src/electron-app-host.ts"]],
    ["vscode", ["/apps/web/src/vscode-app-host.ts"]],
    [
      "android",
      [
        "/apps/web/src/android-app-host.ts",
        "/apps/web/src/android-capabilities-probe.ts",
      ],
    ],
  ]);
  return {
    name: "mamep-enforce-platform-host-boundary",
    apply: "build",
    generateBundle(_options, bundle) {
      const factories = new Set<PlatformFactoryName>();
      const hostImplementations = new Set<string>();
      let containsCapacitor = false;
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const moduleId of output.moduleIds) {
          const normalized = moduleId.replaceAll("\\", "/");
          const match =
            /\/apps\/web\/src\/host-factories\/(browser|electron|vscode|android)\.ts$/.exec(
              normalized,
            );
          if (match?.[1] !== undefined) {
            factories.add(match[1] as PlatformFactoryName);
          }
          if (normalized.includes("/node_modules/@capacitor/")) {
            containsCapacitor = true;
          }
          if (normalized.includes("/node_modules/.pnpm/@capacitor+")) {
            containsCapacitor = true;
          }
          for (const [owner, implementations] of platformHostImplementations) {
            if (implementations.some((entry) => normalized.endsWith(entry))) {
              hostImplementations.add(owner);
            }
          }
        }
      }

      const unexpected = [...factories].filter(
        (factory) => !expectedFactories.has(factory),
      );
      const missing = [...expectedFactories].filter(
        (factory) => !factories.has(factory),
      );
      if (unexpected.length > 0 || missing.length > 0) {
        this.error(
          `[platform-host-boundary] target=${target} factories=${[...factories].sort().join(",") || "none"} expected=${[...expectedFactories].sort().join(",")}`,
        );
      }
      const leakedHosts = [...hostImplementations].filter(
        (owner) => owner !== "browser" && owner !== target,
      );
      if (leakedHosts.length > 0) {
        this.error(
          `[platform-host-boundary] target=${target} includes foreign host implementations: ${leakedHosts.sort().join(",")}`,
        );
      }
      if (target !== "android" && containsCapacitor) {
        this.error(
          `[platform-host-boundary] target=${target} must not bundle @capacitor modules`,
        );
      }
    },
  };
}

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
 * **做法与结论：应用/antd 使用 rolldown 默认的 `codeSplitting`，仅将完整 `react-dom`
 * 包作为一个不拆分内部的独立 chunk。** 该分组不设置 `maxSize`，不按目录或单包内部模块
 * 切分，避免破坏类初始化顺序。配合懒加载与纯包 `sideEffects: false`，当前浏览器生产
 * 基线为：首屏 25 个请求、原始 1.38 MB、gzip 约 441.1 kB，最大 chunk 约 237.8 kB。
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
 * `scripts/verify-web-bundle-budget.mjs` 已接入四端 Web 构建脚本，强制执行
 * 单 chunk ≤ 400 KiB、首屏 gzip ≤ 450 KiB。
 *
 * 平台宿主懒加载：`src/App.tsx` 只负责先渲染启动骨架，再动态加载共享组合根
 * `host-assembly.ts` / `platform-context.ts`；宿主工厂继续按平台动态加载，浏览器共用宿主
 * 不再进入首屏。注意口径：**入口 chunk 变小不等于首屏变小**（应用代码会重分入共享
 * chunk），评估首屏必须算「HTML + 入口 + modulepreload + CSS」。
 */

export default defineConfig(({ command, mode }) => {
  const isElectron = mode === "electron";
  // VSCode Webview 模式：产物独立目录（apps/web/dist-vscode），base "./" 供 asWebviewUri 相对解析。
  const isVscode = mode === "vscode";
  // Android（Capacitor）模式：产物独立目录（apps/web/dist-android），base "./" 供 WebViewAssetLoader 加载。
  const isAndroid = mode === "android";
  const isPlatformBuild = isElectron || isVscode || isAndroid;
  const buildTarget: BuildTarget =
    command === "build"
      ? isElectron
        ? "electron"
        : isVscode
          ? "vscode"
          : isAndroid
            ? "android"
            : "browser"
      : "auto";
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
    resolve: {
      alias:
        buildTarget === "auto"
          ? []
          : [
              {
                find: /^\.\/host-factories\/loader$/,
                replacement: path.resolve(
                  import.meta.dirname,
                  `src/host-factories/loader.${buildTarget}.ts`,
                ),
              },
            ],
    },
    // Electron 生产模式经 loadFile(file://)、VSCode Webview 经 asWebviewUri 加载：必须相对路径。
    base: isPlatformBuild ? "./" : "/",
    build: {
      // 各平台渲染器独立产物目录，与浏览器构建（base /）分开。
      ...(rendererOutDir === undefined
        ? {}
        : { outDir: rendererOutDir, emptyOutDir: true }),
      // 代码分割：不自定义 `codeSplitting.groups`（原因与实测踩坑见文件头注释）。
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: "react-dom",
                test: /node_modules[\\/]react-dom[\\/]/,
              },
            ],
          },
        },
      },
    },
    plugins: [
      react(),
      injectCspMeta(),
      ...(buildTarget === "auto"
        ? []
        : [enforcePlatformHostBuildBoundary(buildTarget)]),
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
