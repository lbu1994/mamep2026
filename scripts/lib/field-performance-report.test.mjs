import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fieldPerformanceMarkdown,
  summarizeFieldPerformanceReport,
} from "./field-performance-report.mjs";

function report(metrics) {
  return {
    schemaVersion: 1,
    kind: "mamep-local-web-performance",
    generatedAt: "2026-11-21T00:00:00.000Z",
    privacy: {
      anonymous: true,
      uploaded: false,
      containsWorkspaceContent: false,
      containsDeviceMessages: false,
    },
    targets: { startupInteractiveMs: 3000, inpMs: 200 },
    sessions: [
      {
        collectedAt: "2026-11-21T00:00:00.000Z",
        cacheMode: "cold",
        declaredZoomPercent: 125,
        networkProfile: "wifi",
        environment: {
          userAgent: "Test Browser",
          hardwareConcurrency: 4,
          deviceMemoryGb: 8,
          viewportWidth: 390,
          viewportHeight: 844,
          devicePixelRatio: 3,
        },
        context: {
          theme: "dark",
          activeSheetRows: 1000,
          totalWorkspaceRows: 1000,
        },
        metrics,
      },
    ],
  };
}

describe("field performance report summary", () => {
  it("marks a passing real-device session", () => {
    const summary = summarizeFieldPerformanceReport(
      report({
        startupInteractiveMs: 2900,
        inpMs: 180,
        interactionCount: 5,
      }),
    );
    assert.equal(summary.status, "passed");
    assert.equal(summary.failures.length, 0);
    assert.match(fieldPerformanceMarkdown(summary), /总体状态：\*\*通过\*\*/);
  });

  it("lists over-budget and missing scenarios explicitly", () => {
    const overBudget = summarizeFieldPerformanceReport(
      report({
        startupInteractiveMs: 3200,
        inpMs: 240,
        interactionCount: 5,
      }),
    );
    assert.equal(overBudget.status, "failed");
    const markdown = fieldPerformanceMarkdown(overBudget);
    assert.match(markdown, /启动 3200 ms/);
    assert.match(markdown, /INP 240 ms/);

    const missing = summarizeFieldPerformanceReport(
      report({ startupInteractiveMs: 2000, inpMs: null }),
    );
    assert.equal(missing.rows[0].status, "unverified");
    assert.match(
      fieldPerformanceMarkdown(missing),
      /缺少启动可交互或 INP 采样/,
    );
  });

  it("rejects reports that claim upload or missing privacy declarations", () => {
    const invalid = report({
      startupInteractiveMs: 2000,
      inpMs: 100,
    });
    invalid.privacy.uploaded = true;
    assert.throws(
      () => summarizeFieldPerformanceReport(invalid),
      /privacy\.uploaded must be false/,
    );
  });
});
