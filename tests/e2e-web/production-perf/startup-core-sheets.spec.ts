import { expect, test } from "../tests/fixtures";
import { WEB_PERF_BUDGETS } from "./budgets";
import { resolveEdgeExecutable } from "./edge";
import { finishPerformanceReport, maxBudgetCheck } from "./performance-report";
import {
  ROW_COUNT,
  readWorkspace,
  seedWorkspace,
  writeWorkspace,
} from "./workspace-fixture";

// Measure the local preview without Windows proxy auto-discovery delays.
test.use({
  launchOptions: {
    executablePath: resolveEdgeExecutable(),
    args: ["--no-proxy-server"],
  },
});

for (const scenario of ["fresh", "restore"] as const) {
  test(`startup fills core sheets within budget: ${scenario}`, async ({
    page,
  }, testInfo) => {
    let originalId: string | undefined;
    if (scenario === "restore") {
      const workspace = await seedWorkspace(page);
      const original = workspace.sheets[0];
      if (original === undefined) throw new Error("Missing seeded sheet.");
      originalId = original.sheetId;
      // Restore a legacy workspace containing only a 1000-row holding sheet.
      workspace.sheets = [original];
      await writeWorkspace(page, workspace);
    }

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.clearBrowserCache");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    try {
      await page.goto("http://localhost:4173/");
      await expect(page.locator('[data-startup-hydrated="true"]')).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.locator(".register-table-tabs [role=tab]")).toHaveCount(
        4,
      );
      await expect
        .poll(async () => {
          try {
            return (await readWorkspace(page)).sheets.length;
          } catch {
            return 0;
          }
        })
        .toBe(4);
      const saved = await readWorkspace(page);
      expect(saved.sheets.map((sheet) => sheet.type)).toEqual([
        "holding-register",
        "coil",
        "discrete-input",
        "input-register",
      ]);
      if (originalId !== undefined) {
        expect(saved.activeSheetId).toBe(originalId);
        expect(saved.sheets[0]?.rows).toHaveLength(ROW_COUNT);
        await expect(page.locator('[data-row-key="perf--0001"]')).toBeVisible();
      }
      const timings = await page.evaluate(() => {
        const interactive = performance.getEntriesByName(
          "mamep:startup:interactive",
        )[0];
        if (interactive === undefined) throw new Error("Missing startup mark.");
        const table = performance.getEntriesByName("mamep:ui:table-ready")[0];
        const columns = performance.getEntriesByName(
          "mamep:ui:table-columns-ready",
        )[0];
        if (table === undefined || columns === undefined)
          throw new Error("Missing table readiness marks.");
        return {
          interactiveMs: interactive.startTime,
          tableReadyMs: Math.max(table.startTime, columns.startTime),
          navigation: performance
            .getEntriesByType("navigation")
            .map((entry) => entry.toJSON()),
          resources: performance
            .getEntriesByType("resource")
            .sort((left, right) => right.duration - left.duration)
            .slice(0, 10)
            .map(({ name, startTime, duration }) => ({
              name,
              startTime,
              duration,
            })),
          marks: performance
            .getEntriesByType("mark")
            .filter((entry) => entry.name.startsWith("mamep:"))
            .map((entry) => ({ name: entry.name, at: entry.startTime })),
        };
      });
      await finishPerformanceReport(testInfo, {
        name: `startup-core-sheets-${scenario}`,
        metrics: timings,
        budgetChecks: [
          maxBudgetCheck(
            "firstInteractive",
            timings.interactiveMs,
            WEB_PERF_BUDGETS.playwright.firstInteractiveMs,
            "ms",
          ),
          maxBudgetCheck(
            "tableReady",
            timings.tableReadyMs,
            WEB_PERF_BUDGETS.playwright.firstInteractiveMs,
            "ms",
          ),
        ],
        notes: [
          "Cold browser cache; existing startup budget; no device connection.",
        ],
      });
    } finally {
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
      await cdp.detach();
    }
  });
}
