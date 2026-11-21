import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

function resolveEdgeExecutable(): string | undefined {
  const candidates = [
    process.env.MAMEP_EDGE_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    process.env["PROGRAMFILES(X86)"]
      ? join(
          process.env["PROGRAMFILES(X86)"],
          "Microsoft/Edge/Application/msedge.exe",
        )
      : undefined,
    process.env.PROGRAMFILES
      ? join(process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe")
      : undefined,
  ];
  return candidates.find(
    (candidate): candidate is string =>
      candidate !== undefined && existsSync(candidate),
  );
}

const edgeExecutable = resolveEdgeExecutable();

export default defineConfig({
  testDir: "./production-perf",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...(edgeExecutable === undefined
      ? { channel: "msedge" as const }
      : { executablePath: edgeExecutable }),
    viewport: { width: 1600, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "pnpm -w --filter @mamep2026/web build && pnpm --dir ../../apps/web exec vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    // 本地连续运行时允许复用刚启动的 preview；CI 使用干净环境时仍会自行构建启动。
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
