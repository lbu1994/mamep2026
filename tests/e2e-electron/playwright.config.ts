import { defineConfig } from "@playwright/test";

// Electron E2E：直接启动生产构建（dist-electron/main.js + apps/web/dist-electron/），
// 不需要 dev server；pretest 已先执行 build:electron。
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
});
