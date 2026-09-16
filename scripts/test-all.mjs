// 全量测试编排（等同原 `pnpm test:all` 链），为每个步骤落盘独立日志。
// 用法：node scripts/test-all.mjs
//   - 可被 `pnpm test:all` 调用；多余参数（如 --no-open）被忽略。
//   - 若设置环境变量 MAMEP_TEST_ALL_STEPS（逗号分隔的脚本名），只运行给定子集，
//     便于单独跑某几步并快速查看报告。
//
// 行为：
//   - 按固定顺序依次运行各步骤（与 package.json `test:all` 链一致），fail-fast。
//   - 通过环境变量 MAMEP_TEST_REPORT_DIR 把各步骤的日志汇聚到同一个 run 目录。
//   - 结束时写 result.json（总体 status + 步骤结果），并打印日志目录路径。
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRunDir, readSummary } from "./lib/test-report.mjs";

// 步骤顺序与 package.json `test:all` 完全一致；值即 npm/pnpm 脚本名。
const STEPS = [
  "test:e2e:web:real",
  "test:e2e:electron:real",
  "test:e2e:vscode:real",
  "test",
  "test:acceptance",
  "test:e2e:web",
  "test:e2e:electron",
  "test:e2e:vscode",
  "test:serial:virtual",
  "lint",
  "typecheck",
];

function runScript(script, env) {
  return new Promise((resolve) => {
    const child = spawn(`pnpm ${script}`, {
      shell: true,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("error", (err) => {
      console.error(`[test:all] 启动失败 ${script}: ${err.message}`);
      resolve(-1);
    });
    child.on("close", (code) => resolve(code ?? -1));
  });
}

async function main() {
  const logDir = createRunDir();
  const startedAt = new Date().toISOString();
  const steps = [];
  let failedStep = null;

  // 允许通过环境变量只跑部分步骤（便于子集验证 / 单独查看某几步报告）。
  const only = process.env.MAMEP_TEST_ALL_STEPS;
  const targets = only
    ? only
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  for (const script of STEPS) {
    if (targets && !targets.includes(script)) continue;
    const t0 = Date.now();
    console.log(`\n===== [test:all] ${script} =====`);
    const exitCode = await runScript(script, { MAMEP_TEST_REPORT_DIR: logDir });
    const durationMs = Date.now() - t0;
    steps.push({
      name: script,
      command: `pnpm ${script}`,
      exitCode,
      durationMs,
    });
    if (exitCode !== 0) {
      failedStep = script;
      break;
    }
  }

  const finishedAt = new Date().toISOString();
  const status = failedStep ? "failed" : "passed";
  const result = {
    runId: path.basename(logDir),
    command: "pnpm test:all",
    startedAt,
    finishedAt,
    platform: `${os.platform()} ${os.arch()}`,
    node: process.version,
    status,
    failedStep,
    steps,
    summary: readSummary(logDir),
    logDir,
  };

  writeFileSync(
    path.join(logDir, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );

  if (failedStep) {
    console.error(`\n===== [test:all] 失败，中止于步骤: ${failedStep} =====`);
  } else {
    console.log("\n===== [test:all] 全部通过 =====");
  }
  console.log(`日志目录: ${path.resolve(logDir)}`);
  process.exit(failedStep ? 1 : 0);
}

main();
