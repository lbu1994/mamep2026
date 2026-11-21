import lighthouse, { desktopConfig } from "lighthouse";
import { launch, type LaunchedChrome } from "chrome-launcher";
import { expect, test } from "@playwright/test";
import { WEB_PERF_BUDGETS } from "./budgets";
import { resolveEdgeExecutable } from "./edge";
import {
  finishPerformanceReport,
  maxBudgetCheck,
  median,
  type BudgetCheck,
} from "./performance-report";

const BASE_URL = "http://localhost:4173/";
const SAMPLE_COUNT = WEB_PERF_BUDGETS.lighthouse.sampleCount;

type FormFactor = "desktop" | "mobile";

interface LighthouseSample {
  formFactor: FormFactor;
  run: number;
  fcpMs: number;
  lcpMs: number;
  ttiMs: number;
  tbtMs: number;
  cls: number;
  score: number | null;
  requestCount: number;
  totalTransferBytes: number;
  maxChunkBytes: number;
  benchmarkIndex: number;
  lighthouseVersion: string;
  fetchedAt: string;
  userAgent: string;
  runtimeError: string | null;
}

interface NetworkItem {
  resourceType?: string;
  transferSize?: number;
}

test.setTimeout(600_000);

function auditNumber(
  audits: Record<string, { numericValue?: number }>,
  id: string,
): number {
  const value = audits[id]?.numericValue;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Lighthouse audit ${id} has no finite numericValue`);
  }
  return value;
}

function auditScore(
  categories: Record<string, { score?: number | null }>,
): number | null {
  const score = categories.performance?.score;
  return typeof score === "number" ? score : null;
}

function networkItems(
  audits: Record<string, { details?: unknown }>,
): NetworkItem[] {
  const details = audits["network-requests"]?.details;
  if (typeof details !== "object" || details === null) return [];
  const items = (details as { items?: unknown }).items;
  return Array.isArray(items)
    ? items.filter(
        (item): item is NetworkItem =>
          typeof item === "object" && item !== null,
      )
    : [];
}

async function runLighthouseSample(
  formFactor: FormFactor,
  run: number,
): Promise<LighthouseSample> {
  let chrome: LaunchedChrome | undefined;
  try {
    chrome = await launch({
      chromePath: resolveEdgeExecutable(),
      chromeFlags: [
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
      ],
      logLevel: "error",
    });
    const result = await lighthouse(
      BASE_URL,
      {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance"],
      },
      formFactor === "desktop" ? desktopConfig : undefined,
    );
    if (result === undefined) throw new Error("Lighthouse returned no result");
    const { lhr } = result;
    const requests = networkItems(lhr.audits);
    const scripts = requests.filter(
      (request) => request.resourceType === "Script",
    );
    return {
      formFactor,
      run,
      fcpMs: auditNumber(lhr.audits, "first-contentful-paint"),
      lcpMs: auditNumber(lhr.audits, "largest-contentful-paint"),
      ttiMs: auditNumber(lhr.audits, "interactive"),
      tbtMs: auditNumber(lhr.audits, "total-blocking-time"),
      cls: auditNumber(lhr.audits, "cumulative-layout-shift"),
      score: auditScore(lhr.categories),
      requestCount: requests.length,
      totalTransferBytes: requests.reduce(
        (total, request) => total + (request.transferSize ?? 0),
        0,
      ),
      maxChunkBytes: Math.max(
        0,
        ...scripts.map((request) => request.transferSize ?? 0),
      ),
      benchmarkIndex: lhr.environment.benchmarkIndex,
      lighthouseVersion: lhr.lighthouseVersion,
      fetchedAt: lhr.fetchTime,
      userAgent: lhr.userAgent,
      runtimeError: lhr.runtimeError?.message ?? null,
    };
  } finally {
    chrome?.kill();
  }
}

function medianOf(
  samples: readonly LighthouseSample[],
  field: keyof Pick<
    LighthouseSample,
    | "fcpMs"
    | "lcpMs"
    | "ttiMs"
    | "tbtMs"
    | "cls"
    | "requestCount"
    | "totalTransferBytes"
    | "maxChunkBytes"
  >,
): number {
  return median(samples.map((sample) => sample[field]));
}

function budgetChecks(
  formFactor: FormFactor,
  samples: readonly LighthouseSample[],
): BudgetCheck[] {
  const budget = WEB_PERF_BUDGETS.lighthouse[formFactor];
  return [
    maxBudgetCheck(
      `${formFactor}.fcpMs`,
      medianOf(samples, "fcpMs"),
      budget.fcpMs,
      "ms",
    ),
    maxBudgetCheck(
      `${formFactor}.lcpMs`,
      medianOf(samples, "lcpMs"),
      budget.lcpMs,
      "ms",
    ),
    maxBudgetCheck(
      `${formFactor}.ttiMs`,
      medianOf(samples, "ttiMs"),
      budget.ttiMs,
      "ms",
    ),
    maxBudgetCheck(
      `${formFactor}.tbtMs`,
      medianOf(samples, "tbtMs"),
      budget.tbtMs,
      "ms",
    ),
    maxBudgetCheck(
      `${formFactor}.cls`,
      medianOf(samples, "cls"),
      budget.cls,
      "score",
    ),
    maxBudgetCheck(
      `${formFactor}.requestCount`,
      medianOf(samples, "requestCount"),
      budget.requestCount,
      "count",
    ),
    maxBudgetCheck(
      `${formFactor}.totalTransferBytes`,
      medianOf(samples, "totalTransferBytes"),
      budget.totalTransferBytes,
      "bytes",
    ),
    maxBudgetCheck(
      `${formFactor}.maxChunkBytes`,
      medianOf(samples, "maxChunkBytes"),
      budget.maxChunkBytes,
      "bytes",
    ),
  ];
}

test("Lighthouse 桌面与移动模拟各 3 次并校验中位数预算", async ({
  browserName: _browserName,
}, testInfo) => {
  const samples: LighthouseSample[] = [];
  for (const formFactor of ["desktop", "mobile"] as const) {
    for (let run = 1; run <= SAMPLE_COUNT; run += 1) {
      const sample = await runLighthouseSample(formFactor, run);
      if (sample.runtimeError !== null) {
        throw new Error(
          `Lighthouse ${formFactor} run ${run}: ${sample.runtimeError}`,
        );
      }
      samples.push(sample);
      console.log(
        `[lighthouse] ${formFactor} run ${run}: ${JSON.stringify(sample)}`,
      );
    }
  }

  const desktop = samples.filter((sample) => sample.formFactor === "desktop");
  const mobile = samples.filter((sample) => sample.formFactor === "mobile");
  const checks = [
    ...budgetChecks("desktop", desktop),
    ...budgetChecks("mobile", mobile),
  ];
  await finishPerformanceReport(testInfo, {
    name: "lighthouse",
    metrics: {
      baseUrl: BASE_URL,
      sampleCountPerFormFactor: SAMPLE_COUNT,
      samples,
      medians: {
        desktop: {
          fcpMs: medianOf(desktop, "fcpMs"),
          lcpMs: medianOf(desktop, "lcpMs"),
          ttiMs: medianOf(desktop, "ttiMs"),
          tbtMs: medianOf(desktop, "tbtMs"),
          cls: medianOf(desktop, "cls"),
          requestCount: medianOf(desktop, "requestCount"),
          totalTransferBytes: medianOf(desktop, "totalTransferBytes"),
          maxChunkBytes: medianOf(desktop, "maxChunkBytes"),
        },
        mobile: {
          fcpMs: medianOf(mobile, "fcpMs"),
          lcpMs: medianOf(mobile, "lcpMs"),
          ttiMs: medianOf(mobile, "ttiMs"),
          tbtMs: medianOf(mobile, "tbtMs"),
          cls: medianOf(mobile, "cls"),
          requestCount: medianOf(mobile, "requestCount"),
          totalTransferBytes: medianOf(mobile, "totalTransferBytes"),
          maxChunkBytes: medianOf(mobile, "maxChunkBytes"),
        },
      },
      inpApproxMs: null,
    },
    budgetChecks: checks,
    notes: [
      "Lighthouse 导航模式不产生用户交互，INP 近似值由 Playwright Event Timing 场景输出。",
      "移动端使用 Lighthouse 标准慢速 4G 与 CPU 节流模拟，不代表真实低端设备。",
    ],
  });
  expect(samples).toHaveLength(SAMPLE_COUNT * 2);
});
