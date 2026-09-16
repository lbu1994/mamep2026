// 用 Node 内置 node:test 验证 test-report 基建的纯函数与 runLogged 行为。
// 运行：node --test scripts/lib/test-report.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  readSummary,
  runLogged,
  stripAnsi,
  timestamp,
} from "./test-report.mjs";

test("stripAnsi 去除 ANSI 转义序列", () => {
  assert.equal(stripAnsi("\x1b[32mok\x1b[0m"), "ok");
  assert.equal(stripAnsi("plain text"), "plain text");
  assert.equal(stripAnsi("\x1b[1;34mhello\x1b[m world"), "hello world");
  assert.equal(stripAnsi("a\x1b[2Kb\x1b[1A"), "ab");
});

test("timestamp 生成 YYYYMMDD-HHmmss-SSS 形状", () => {
  assert.match(
    timestamp(new Date(2026, 8, 7, 12, 3, 4, 5)),
    /^20260907-120304-005$/,
  );
});

test("runLogged 输出日志、写入 summary 并返回退出码", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "test-report-"));
  try {
    const code = await runLogged({
      command: 'node -e "console.log(42)"',
      name: "mock",
      logDir: dir,
    });
    assert.equal(code, 0);
    const log = readFileSync(path.join(dir, "mock.log"), "utf8");
    assert.match(log, /42/);
    const summary = readSummary(dir);
    assert.equal(summary.length, 1);
    assert.equal(summary[0].name, "mock");
    assert.equal(summary[0].exitCode, 0);
    assert.equal(typeof summary[0].durationMs, "number");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runLogged 对失败命令返回非零退出码", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "test-report-"));
  try {
    const code = await runLogged({
      command: 'node -e "process.exit(3)"',
      name: "fail",
      logDir: dir,
    });
    assert.equal(code, 3);
    const summary = readSummary(dir);
    assert.equal(summary[0].exitCode, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runLogged 日志文件去除 ANSI 转义", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "test-report-"));
  try {
    await runLogged({
      command:
        "node -e \"process.stdout.write(String.fromCharCode(27)+'[32mcolor')\"",
      name: "ansi",
      logDir: dir,
    });
    const log = readFileSync(path.join(dir, "ansi.log"), "utf8");
    assert.equal(log, "color");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
