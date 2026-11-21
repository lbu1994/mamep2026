import { defineConfig } from "@playwright/test";
import { resolveEdgeExecutable } from "./production-perf/edge";

const edgeExecutable = resolveEdgeExecutable();

export default defineConfig({
  testDir: "./production-perf",
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["./production-perf/performance-reporter.ts"]],
  use: {
    launchOptions: { executablePath: edgeExecutable },
    viewport: { width: 1600, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "pnpm --filter @mamep2026/web build && pnpm --dir ../../apps/web exec vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    // 性能基线必须由本次生产构建提供，不能复用可能过期的 dev/preview 进程。
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
