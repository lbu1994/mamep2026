import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

// https://vite.dev/config/
// 默认模式（pnpm dev / pnpm build）只构建网页端；
// 使用 `--mode electron`（pnpm dev:electron / pnpm build:electron）时才接入 Electron 主进程。
export default defineConfig(({ mode }) => {
  const isElectron = mode === "electron";
  // 应用版本号取自根 package.json（三端共用版本），经 __APP_VERSION__ 注入，dev/build 均生效。
  const rootPkg = JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, "../../package.json"),
      "utf-8",
    ),
  ) as { version: string };

  return {
    define: {
      __APP_VERSION__: JSON.stringify(rootPkg.version),
    },
    plugins: [
      react(),
      ...(isElectron
        ? [
            electron({
              main: {
                // 保持与迁移前一致：主进程源码仍在仓库根 electron/，产物输出到根 dist-electron/
                entry: path.resolve(
                  import.meta.dirname,
                  "../../electron/main.ts",
                ),
                vite: {
                  build: {
                    outDir: path.resolve(
                      import.meta.dirname,
                      "../../dist-electron",
                    ),
                  },
                },
              },
            }),
          ]
        : []),
    ],
  };
});
