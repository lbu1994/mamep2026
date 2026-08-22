/**
 * VSCode 端串口探针启动器（原型，docs/TECH_DESIGN.md §34.3.15）。
 * 用 @vscode/test-electron 启动真实 VSCode，在扩展宿主中执行 dist/probe-serial.run.js
 * （导出 run()），验证 serialport 原生模块在 Extension Host 的加载/枚举/打开/FC03 闭环/关闭。
 * 自动拉起/关闭 modbus-slave（COM5）。前置：com0com COM4↔COM5 已配置。
 * 运行：pnpm probe:vscode:serial
 */
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

// 本文件位于 tests/e2e-vscode/scripts/：上跳三级到仓库根（AGENTS.md 的已知坑）。
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SLAVE_SCRIPT = path.resolve(
  ROOT,
  "scripts/modbus-slave/modbus-rtu-slave.mjs",
);
const E2E_VSCODE = path.resolve(ROOT, "tests/e2e-vscode");
const extensionDevelopmentPath = path.resolve(ROOT, "apps/vscode-extension");
const extensionTestsPath = path.resolve(
  ROOT,
  "tests/e2e-vscode/dist/probe-serial.run.js",
);

function startSlave() {
  return new Promise((resolveReady, rejectReady) => {
    const child = spawn(process.execPath, [SLAVE_SCRIPT], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectReady(new Error(`slave 未在 15s 内就绪:\n${output}`));
      }
    }, 15000);
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
      if (!settled && output.includes("从站就绪")) {
        settled = true;
        clearTimeout(timer);
        resolveReady(child);
      }
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectReady(
          new Error(
            `slave 提前退出 code=${code}（COM5 可能已被占用）:\n${output}`,
          ),
        );
      }
    });
  });
}

function stopSlave(child) {
  return new Promise((resolveDone) => {
    if (child === null || child.exitCode !== null) {
      resolveDone();
      return;
    }
    child.on("exit", () => resolveDone());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolveDone();
    }, 2000);
  });
}

// 先编译探针（dist/probe-serial.run.js）。
const build = spawnSync(
  "pnpm",
  ["--filter", "@mamep2026/e2e-vscode", "build"],
  {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
if (build.status !== 0) {
  console.error("[probe:vscode] 编译探针失败");
  process.exit(build.status ?? 1);
}

const slave = await startSlave();
console.log("[probe:vscode] modbus-slave 已在 COM5 就绪");
try {
  const code = await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [],
  });
  if (code !== 0) {
    console.error(`[probe:vscode] 探针退出码 ${code}`);
    process.exit(code);
  }
  console.log("[probe:vscode] 探针执行完毕（结果见上方 [probe] 输出）");
} catch (cause) {
  console.error("[probe:vscode] 运行 VSCode 探针失败");
  console.error(
    cause instanceof Error ? (cause.stack ?? cause.message) : cause,
  );
  process.exit(1);
} finally {
  await stopSlave(slave);
}
