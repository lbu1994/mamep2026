import { defineConfig } from "@playwright/test";

// 浏览器端「真实端口」e2e：系统 Edge + 有头（headless 无法弹出系统 Web Serial picker）。
// 仅由 scripts/e2e-real.mjs 以 MAMEP_REAL=1 调用（pnpm test:e2e:web:real）；
// 未设置 MAMEP_REAL 时用例自行 skip。
export default defineConfig({
  testDir: "./tests-real",
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    channel: "msedge",
    headless: false,
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
