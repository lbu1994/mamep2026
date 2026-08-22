/**
 * VSCode 端 e2e 启动器：用 @vscode/test-electron 启动真实 VSCode，
 * 加载 apps/vscode-extension（extensionDevelopmentPath → ExtensionMode.Development，
 * dev 探针可用），执行 dist/run.test.js（导出 run()，由 VSCode 测试宿主调用并等待）。
 * 前置：pnpm build:vscode（根 test:e2e:vscode 已自动执行；@vscode/test-electron 需联网
 * 下载 VSCode，网络受阻时降级为 .vscode/launch.json F5 手动验证）。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

// 本文件位于 tests/e2e-vscode/scripts/：上跳三级到仓库根（AGENTS.md 的已知坑）。
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const extensionDevelopmentPath = path.resolve(ROOT, "apps/vscode-extension");
const extensionTestsPath = path.resolve(
  ROOT,
  "tests/e2e-vscode/dist/run.test.js",
);

try {
  const code = await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [],
  });
  if (code !== 0) {
    console.error(`[e2e-vscode] tests exited with code ${code}`);
    process.exit(code);
  }
  console.log("[e2e-vscode] all checks passed");
} catch (cause) {
  console.error("[e2e-vscode] failed to run VSCode integration tests");
  console.error(cause instanceof Error ? cause.stack ?? cause.message : cause);
  process.exit(1);
}
