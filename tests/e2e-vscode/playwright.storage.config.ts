import path from "node:path";
import { defineConfig } from "@playwright/test";

// Run real VSCode processes without requiring a serial device or a TCP slave.
export default defineConfig({
  testDir: path.join(__dirname, "real"),
  testMatch: "plugin-storage.spec.ts",
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  outputDir: "test-results/plugin-storage",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/plugin-storage.json" }],
  ],
});
