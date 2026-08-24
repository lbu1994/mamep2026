import { defineConfig } from "@playwright/test";

// Electron 端「真实端口」e2e：生产构建路径启动（pretest:real 自动 build:electron）。
// 仅由 scripts/e2e-real.mjs 以 MAMEP_REAL=1 调用（pnpm test:e2e:electron:real）；
// 未设置 MAMEP_REAL 时用例自行 skip。
export default defineConfig({
  testDir: "./tests-real",
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
});
