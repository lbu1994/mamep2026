/**
 * VSCode 端 e2e 启动器：用 @vscode/test-electron 启动真实 VSCode，
 * 加载 apps/vscode-extension（extensionDevelopmentPath → ExtensionMode.Development，
 * dev 探针可用），执行 dist/run.test.js（导出 run()，由 VSCode 测试宿主调用并等待）。
 * 前置：pnpm build:vscode（根 test:e2e:vscode 已自动执行；@vscode/test-electron 需联网
 * 下载 VSCode，网络受阻时降级为 .vscode/launch.json F5 手动验证）。
 */
import path from "node:path";
import os from "node:os";
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

// e2e 统一注入宿主进程内假串口（Extension Host 装配 DevFakeSerialFactory，内联
// CRC16 RTU responder）与假 TCP 设备（DevFakeTcpServer，127.0.0.1:1502，MBAP
// responder）：确定性、无真实设备依赖；runTests 子进程继承本环境变量。
process.env.MAMEP_FAKE_SERIAL = "1";
process.env.MAMEP_FAKE_TCP = "1";
// 假 TCP 设备每条响应附加延迟（2026-09-06 移除 Rx Delay 后，为批任务取消 e2e 提供可取消窗口）。
process.env.MAMEP_FAKE_TCP_DELAY_MS = "40";
// dev/e2e 假文件对话框（MAMEP_FAKE_DIALOG=1，ADR-033 方案 A）：测试宿主与扩展宿主跨进程、
// 无法桩替换 vscode.window 对话框，扩展宿主在 isDev 门控下把 save/open 对话框替换为对
// 固定路径的读写（工作区导入导出闭环确定性自动化）。路径经环境变量暴露给测试用例。
process.env.MAMEP_FAKE_DIALOG = "1";
process.env.MAMEP_FAKE_DIALOG_OPEN_PATH = path.join(
  os.tmpdir(),
  "mamep-e2e-dialog-open.json",
);
process.env.MAMEP_FAKE_DIALOG_SAVE_PATH = path.join(
  os.tmpdir(),
  "mamep-e2e-dialog-save.json",
);
// 宿主侧插件执行面 e2e（ADR-055）：插件产物路径经环境变量暴露给用例（需先 `pnpm build:plugins`，
// 根 test:e2e:vscode 已自动执行）。测试宿主与扩展宿主为同一进程外的两个世界，用例不猜路径。
const PLUGIN_DIR = path.join(
  ROOT,
  "release",
  "plugins",
  "builtin-address-adjust",
);
process.env.MAMEP_PLUGIN_ENTRY_PATH = path.join(
  PLUGIN_DIR,
  "builtin-address-adjust.mjs",
);
process.env.MAMEP_PLUGIN_MANIFEST_PATH = path.join(PLUGIN_DIR, "manifest.json");

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
  console.error(
    cause instanceof Error ? (cause.stack ?? cause.message) : cause,
  );
  process.exit(1);
}
