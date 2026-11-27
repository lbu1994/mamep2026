import path from "node:path";
import { defineConfig } from "@playwright/test";
import type {
  VSCodeTestOptions,
  VSCodeWorkerOptions,
} from "vscode-test-playwright";

// VSCode 端「真实端口」e2e（UI 级，vscode-test-playwright 驱动 VS Code UI + Webview）。
// - extensionDevelopmentPath 指向 apps/vscode-extension（需先 pnpm build:vscode 产出 dist/）；
// - 生产 webview（未设 MAMEP_DEV_URL → getProdHtml），webview 内容在 vscode-webview:// iframe；
// - 仅由 scripts/e2e-real.mjs 以 MAMEP_REAL=1 调用（pnpm test:e2e:vscode:real）；
//   未设置 MAMEP_REAL 时用例自行 skip。
export default defineConfig<VSCodeTestOptions, VSCodeWorkerOptions>({
  testDir: path.join(__dirname, "real"),
  testIgnore: ["plugin-storage.spec.ts", "lifecycle.spec.ts"],
  timeout: 300_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1, // VS Code 测试必须单 worker。
  reporter: [["list"]],
  use: {
    extensionDevelopmentPath: path.resolve(
      __dirname,
      "../../apps/vscode-extension",
    ),
    vscodeVersion: "stable",
    vscodeTrace: "on",
  },
});
