import { defineConfig } from "@playwright/test";

// 浏览器端 E2E：使用系统 Edge（channel: msedge），不下载 Chromium。
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    channel: "msedge",
    viewport: { width: 1600, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @mamep2026/web dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
