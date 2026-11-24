import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

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
    process.env["ProgramFiles(x86)"]
      ? join(
          process.env["ProgramFiles(x86)"],
          "Microsoft/Edge/Application/msedge.exe",
        )
      : undefined,
    process.env.PROGRAMFILES
      ? join(process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe")
      : undefined,
    process.env.ProgramFiles
      ? join(process.env.ProgramFiles, "Microsoft/Edge/Application/msedge.exe")
      : undefined,
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Microsoft/Edge/Application/msedge.exe")
      : undefined,
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
  ];
  return candidates.find(
    (candidate): candidate is string =>
      candidate !== undefined && existsSync(candidate),
  );
}

// 浏览器端 E2E：使用系统 Edge（channel: msedge），不下载 Chromium。
const edgeExecutable = resolveEdgeExecutable();
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...(edgeExecutable === undefined
      ? { channel: "msedge" as const }
      : { launchOptions: { executablePath: edgeExecutable } }),
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
