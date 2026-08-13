import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

// https://vite.dev/config/
// 默认模式（pnpm dev / pnpm build）只构建网页端；
// 使用 `--mode electron`（pnpm dev:electron / pnpm build:electron）时才接入 Electron 主进程。
export default defineConfig(({ mode }) => {
  const isElectron = mode === "electron";

  return {
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
