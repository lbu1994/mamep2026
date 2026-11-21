import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FullResult, Reporter } from "@playwright/test/reporter";
import {
  performanceReportDirectory,
  performanceRunId,
} from "./performance-report";

interface StoredPerformanceReport {
  name: string;
  status: "passed" | "failed";
  budgetChecks: Array<{ passed: boolean }>;
  [key: string]: unknown;
}

/** 把所有性能用例的 JSON 汇总为每次执行唯一、可归档的基线报告。 */
export default class PerformanceReporter implements Reporter {
  onBegin(): void {
    process.env.MAMEP_PERFORMANCE_RUN_ID ??= new Date()
      .toISOString()
      .replace(/[^0-9]/g, "");
  }

  onEnd(result: FullResult): void {
    const directory = performanceReportDirectory();
    mkdirSync(directory, { recursive: true });
    const prefix = `web-performance-run-${performanceRunId()}-`;
    const reports = readdirSync(directory)
      .filter((file) => file.startsWith(prefix) && file.endsWith(".json"))
      .sort()
      .map(
        (file) =>
          JSON.parse(
            readFileSync(path.join(directory, file), "utf8"),
          ) as StoredPerformanceReport,
      );
    const aggregate = {
      schemaVersion: 1,
      runId: performanceRunId(),
      generatedAt: new Date().toISOString(),
      testStatus: result.status,
      status:
        result.status === "passed" &&
        reports.length > 0 &&
        reports.every((report) => report.status === "passed")
          ? "passed"
          : "failed",
      reportCount: reports.length,
      reports,
    };
    writeFileSync(
      path.join(directory, "web-performance-baseline.json"),
      `${JSON.stringify(aggregate, null, 2)}\n`,
    );
  }
}
