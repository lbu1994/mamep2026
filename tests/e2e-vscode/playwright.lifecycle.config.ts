import path from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: path.join(__dirname, "real"),
  testMatch: "lifecycle.spec.ts",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  outputDir: "test-results/lifecycle",
  reporter: [["list"], ["json", { outputFile: "test-results/lifecycle.json" }]],
});
