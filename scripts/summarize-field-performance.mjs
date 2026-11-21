#!/usr/bin/env node
/**
 * 汇总浏览器 Settings 导出的本地 Web 性能 JSON。
 *
 * 用法：
 *   node scripts/summarize-field-performance.mjs <report...> [--out <file>]
 *
 * 脚本只读取本地文件，不发起网络请求。任一场景缺少启动可交互时间/INP，或超过预算，
 * 均以非零退出码结束，方便将真实设备结果纳入发布验收。
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  fieldPerformanceMarkdown,
  summarizeFieldPerformanceReport,
} from "./lib/field-performance-report.mjs";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outputPath = outIndex >= 0 ? args[outIndex + 1] : undefined;
const files =
  outIndex >= 0
    ? args.filter((_, index) => index !== outIndex && index !== outIndex + 1)
    : args;

if (files.length === 0) {
  console.error(
    "Usage: node scripts/summarize-field-performance.mjs <report.json...> [--out <summary.md>]",
  );
  process.exit(2);
}
if (outIndex >= 0 && outputPath === undefined) {
  console.error("--out requires a file path");
  process.exit(2);
}

const reports = files.map((file) => {
  try {
    const report = JSON.parse(readFileSync(file, "utf8"));
    // 逐份校验，避免合并时只检查第一份报告的隐私和 Schema 声明。
    summarizeFieldPerformanceReport(report);
    return report;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read ${file}: ${detail}`);
  }
});

const sessions = reports.flatMap((report) => report.sessions ?? []);
const merged = {
  ...reports[0],
  generatedAt: new Date().toISOString(),
  sessions,
};
const summary = summarizeFieldPerformanceReport(merged);
const markdown = fieldPerformanceMarkdown(summary);

if (outputPath !== undefined) {
  writeFileSync(outputPath, markdown, "utf8");
  console.log(`[field-performance-summary] ${outputPath}`);
} else {
  process.stdout.write(markdown);
}

if (summary.status !== "passed") process.exitCode = 1;
