import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type TestInfo } from "@playwright/test";

export interface BudgetCheck {
  id: string;
  actual: number;
  budget: number;
  unit: "ms" | "bytes" | "count" | "score";
  passed: boolean;
}

export interface PerformanceReportPayload {
  name: string;
  metrics: Record<string, unknown>;
  budgetChecks: BudgetCheck[];
  notes?: string[];
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const REPORT_PREFIX = "web-performance-run-";

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median requires samples");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const current = sorted[middle];
  if (current === undefined) throw new Error("median value missing");
  if (sorted.length % 2 === 1) return current;
  const previous = sorted[middle - 1];
  if (previous === undefined) throw new Error("median value missing");
  return (previous + current) / 2;
}

export function maxBudgetCheck(
  id: string,
  actual: number,
  budget: number,
  unit: BudgetCheck["unit"],
): BudgetCheck {
  if (!Number.isFinite(actual)) {
    throw new Error(`${id}: actual value is not finite`);
  }
  return {
    id,
    actual,
    budget,
    unit,
    passed: actual <= budget,
  };
}

export function performanceReportDirectory(): string {
  return (
    process.env.MAMEP_TEST_REPORT_DIR ??
    path.resolve(import.meta.dirname, "../test-results")
  );
}

export function performanceRunId(): string {
  return process.env.MAMEP_PERFORMANCE_RUN_ID ?? "local";
}

function gitValue(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 5_000,
    }).trim();
  } catch {
    return null;
  }
}

export function baselineEnvironment(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const cpu = os.cpus()[0];
  return {
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: cpu?.model ?? "unknown",
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    node: process.version,
    gitCommit: gitValue(["rev-parse", "HEAD"]),
    gitDirty:
      gitValue(["status", "--porcelain", "--untracked-files=no"]) !== "",
    ...extra,
  };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * 报告先落盘再软断言。这样即使某项超预算，失败截图/日志和完整基线仍然可见。
 */
export async function finishPerformanceReport(
  testInfo: TestInfo,
  payload: PerformanceReportPayload,
): Promise<void> {
  const report = {
    schemaVersion: 1,
    runId: performanceRunId(),
    repeatEachIndex: testInfo.repeatEachIndex,
    retry: testInfo.retry,
    generatedAt: new Date().toISOString(),
    environment: baselineEnvironment({
      project: testInfo.project.name,
      browser: "Microsoft Edge",
      trace: testInfo.project.use.trace ?? "off",
    }),
    status: payload.budgetChecks.every((check) => check.passed)
      ? "passed"
      : "failed",
    ...payload,
  };
  const directory = performanceReportDirectory();
  mkdirSync(directory, { recursive: true });
  // Keep every repeated sample, including failures, in the aggregate report.
  const sampleSuffix =
    testInfo.repeatEachIndex > 0 || testInfo.retry > 0
      ? `-sample-${testInfo.repeatEachIndex}-retry-${testInfo.retry}`
      : "";
  const file = path.join(
    directory,
    `${REPORT_PREFIX}${performanceRunId()}-${slug(payload.name)}${sampleSuffix}.json`,
  );
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[web-performance:${payload.name}] ${JSON.stringify(report)}`);
  console.log(`[web-performance-report] ${file}`);
  await testInfo.attach(`web-performance-${slug(payload.name)}.json`, {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });

  for (const check of payload.budgetChecks) {
    expect
      .soft(
        check.actual,
        `${check.id}: ${check.actual}${check.unit} > ${check.budget}${check.unit}`,
      )
      .toBeLessThanOrEqual(check.budget);
  }
}
