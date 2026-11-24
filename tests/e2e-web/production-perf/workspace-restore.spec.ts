import type { Page } from "@playwright/test";
import { expect, test } from "../tests/fixtures";
import { WEB_PERF_BUDGETS } from "./budgets";
import {
  finishPerformanceReport,
  maxBudgetCheck,
  median,
  type BudgetCheck,
} from "./performance-report";

import { ROW_COUNT, buildRows, seedWorkspace } from "./workspace-fixture";

interface ProductionPerfState {
  eventTimingSupported: boolean;
  longTaskTimingSupported: boolean;
  keyPaintSamples: Array<{ startTime: number; duration: number }>;
  longTasks: Array<{ startTime: number; duration: number }>;
  interactionEvents: Array<{
    name: string;
    startTime: number;
    duration: number;
  }>;
}

interface FirstScreenSample {
  requestCount: number;
  transferBytes: number;
  maxChunkBytes: number;
}

declare global {
  interface Window {
    __mamepProductionPerf: ProductionPerfState;
  }
}

async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function interactionMark(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

async function eventDurationsSince(
  page: Page,
  startTime: number,
): Promise<number[]> {
  await settleFrames(page);
  return page.evaluate(
    (start: number) =>
      window.__mamepProductionPerf.interactionEvents
        .filter((entry) => entry.startTime >= start)
        .map((entry) => entry.duration),
    startTime,
  );
}

test("1000 行恢复、导入、滚动与编辑达到生产性能预算", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const state: ProductionPerfState = {
      eventTimingSupported: false,
      longTaskTimingSupported: false,
      keyPaintSamples: [],
      longTasks: [],
      interactionEvents: [],
    };
    window.__mamepProductionPerf = state;
    // The second animation frame follows the first paint after the real key event.
    // Keep this conservative duration when Event Timing suppresses a fast entry.
    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key !== "Enter" ||
          !(event.target instanceof HTMLInputElement) ||
          event.target.dataset.registerCell !== "data"
        )
          return;
        const startTime = event.timeStamp;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            state.keyPaintSamples.push({
              startTime,
              duration: performance.now() - startTime,
            });
          }),
        );
      },
      true,
    );
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      }).observe({ type: "longtask", buffered: true });
      state.longTaskTimingSupported =
        PerformanceObserver.supportedEntryTypes.includes("longtask");
    } catch {
      // The scroll probe rejects unsupported timing instead of reporting zero.
    }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType !== "event") continue;
          state.interactionEvents.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      }).observe({
        type: "event",
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit & { durationThreshold: number });
      state.eventTimingSupported =
        PerformanceObserver.supportedEntryTypes.includes("event");
    } catch {
      // 后续 Event Timing 断言会失败，不能用 0ms 伪造支持。
    }
  });

  const workspace = await seedWorkspace(page);
  const hotRestoreSamples: number[] = [];
  const pageInteractiveSamples: number[] = [];
  const workspaceRestoreLongTaskSamples: number[] = [];
  const startupLongTaskSamples: number[] = [];
  const cacheCdp = await page.context().newCDPSession(page);
  let firstScreenSample: FirstScreenSample | undefined;
  try {
    await cacheCdp.send("Network.enable");
    await cacheCdp.send("Network.clearBrowserCache");
    await cacheCdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await page.reload();
    await expect(page.locator('[data-row-key="perf--0001"]')).toBeVisible({
      timeout: 15_000,
    });
    firstScreenSample = await page.evaluate(() => {
      const interactive = performance.getEntriesByName(
        "mamep:startup:interactive",
        "mark",
      )[0];
      if (interactive === undefined) throw new Error("startup mark missing");
      const resources = performance
        .getEntriesByType("resource")
        .filter(
          (entry): entry is PerformanceResourceTiming =>
            entry.startTime <= interactive.startTime,
        );
      const scripts = resources.filter(
        (entry) => entry.initiatorType === "script",
      );
      return {
        requestCount: resources.length,
        transferBytes: resources.reduce(
          (total, entry) => total + entry.transferSize,
          0,
        ),
        maxChunkBytes: Math.max(
          0,
          ...scripts.map((entry) => entry.transferSize),
        ),
      };
    });
  } finally {
    await cacheCdp.send("Network.setCacheDisabled", { cacheDisabled: false });
    await cacheCdp.detach();
  }
  if (firstScreenSample === undefined) {
    throw new Error("cold first-screen sample was not collected");
  }
  // 热恢复取 5 次中位数，吸收单次系统调度抖动；同一次测试仍记录全部样本。
  for (let run = 0; run < 5; run += 1) {
    await page.reload();
    await expect(page.locator('[data-row-key="perf--0001"]')).toBeVisible({
      timeout: 15_000,
    });
    const hotRestoreProbe = await page.evaluate(() => {
      const interactive = performance.getEntriesByName(
        "mamep:startup:interactive",
        "mark",
      )[0];
      const workspaceStart = performance.getEntriesByName(
        "mamep:startup:workspace-start",
        "mark",
      )[0];
      const workspaceSettled = performance.getEntriesByName(
        "mamep:startup:workspace-settled",
        "mark",
      )[0];
      if (
        interactive === undefined ||
        workspaceStart === undefined ||
        workspaceSettled === undefined
      ) {
        throw new Error("startup marks missing");
      }
      return {
        workspaceRestore: workspaceSettled.startTime - workspaceStart.startTime,
        workspaceRestoreLongTaskMax: Math.max(
          0,
          ...window.__mamepProductionPerf.longTasks
            .filter(
              (entry) =>
                entry.startTime >= workspaceStart.startTime &&
                entry.startTime <= workspaceSettled.startTime,
            )
            .map((entry) => entry.duration),
        ),
        interactive: interactive.startTime,
        marks: performance
          .getEntriesByType("mark")
          .filter((entry) => entry.name.startsWith("mamep:startup:"))
          .map((entry) => ({ name: entry.name, at: entry.startTime })),
      };
    });
    hotRestoreSamples.push(hotRestoreProbe.workspaceRestore);
    pageInteractiveSamples.push(hotRestoreProbe.interactive);
    workspaceRestoreLongTaskSamples.push(
      hotRestoreProbe.workspaceRestoreLongTaskMax,
    );
    startupLongTaskSamples.push(
      await page.evaluate(() =>
        Math.max(
          0,
          ...window.__mamepProductionPerf.longTasks.map(
            (entry) => entry.duration,
          ),
        ),
      ),
    );
    const connectionModal = page.locator(".ant-modal-wrap:visible").last();
    if (await connectionModal.isVisible()) {
      const close = connectionModal
        .getByRole("button", { name: /Cancel|Close/i })
        .first();
      if (await close.isVisible()) {
        await close.click();
        // Exclude the closing animation and focus restoration from scrolling.
        await expect(connectionModal).toBeHidden();
      }
    }
  }
  const hotRestoreMs = median(hotRestoreSamples);
  const pageInteractiveMs = median(pageInteractiveSamples);
  const workspaceRestoreLongTaskMaxMs = Math.max(
    ...workspaceRestoreLongTaskSamples,
  );
  console.log(
    `[performance-hot-restore] ${JSON.stringify({
      median: hotRestoreMs,
      samples: hotRestoreSamples,
      pageInteractiveMedian: pageInteractiveMs,
    })}`,
  );
  const startupLongTaskMaxMs = Math.max(...startupLongTaskSamples);

  const scrollMetrics = await page.evaluate(async () => {
    const state = window.__mamepProductionPerf;
    if (!state.longTaskTimingSupported) {
      throw new Error("Long Task timing is not supported");
    }
    const holder = document.querySelector(
      ".register-table-tabs .ant-tabs-content-active .ant-table-tbody-virtual-holder",
    );
    if (holder === null) throw new Error("virtual holder missing");
    holder.scrollTop = 0;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    state.longTasks.length = 0;
    const started = performance.now();
    holder.scrollTop = holder.scrollHeight;
    await new Promise<void>((resolve, reject) => {
      const deadline = started + 3000;
      const tick = (): void => {
        if (document.querySelector('[data-row-key="perf--1000"]') !== null) {
          resolve();
        } else if (performance.now() > deadline) {
          reject(new Error("bottom row did not render"));
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
    const scrollMs = performance.now() - started;
    await new Promise<void>((resolve, reject) => {
      const deadline = started + 3000;
      let quietFrames = 0;
      const tick = (): void => {
        // Include every deferred control upgrade, not only the first row paint.
        if (
          holder.querySelector(".register-table__virtual-placeholder") === null
        ) {
          quietFrames += 1;
        } else {
          quietFrames = 0;
        }
        if (quietFrames >= 2) {
          resolve();
          return;
        }
        if (performance.now() > deadline) {
          reject(new Error("scroll controls did not settle"));
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return {
      scrollMs,
      controlsReadyMs: performance.now() - started,
      longTasks: state.longTasks.map((entry) => ({
        startMs: entry.startTime - started,
        durationMs: entry.duration,
      })),
      longTaskMaxMs: Math.max(
        0,
        ...state.longTasks.map((entry) => entry.duration),
      ),
    };
  });

  const settingsStart = await interactionMark(page);
  await testInfo.attach("scroll-timings.json", {
    body: JSON.stringify(scrollMetrics),
    contentType: "application/json",
  });
  await page
    .locator(".mamep-header")
    .getByRole("button", { name: /^Settings$/ })
    .click();
  const settings = page
    .locator(".ant-drawer")
    .filter({ hasText: "Import Workspace" });
  await expect(settings.getByText("Reset Workspace")).toBeVisible();
  const settingsWallMs =
    (await page.evaluate(() => performance.now())) - settingsStart;
  const settingsEventDurations = await eventDurationsSince(page, settingsStart);
  const settingsEventMs = Math.max(0, ...settingsEventDurations);
  await settings.locator(".ant-drawer-close").first().click();
  await expect(settings.locator(".ant-drawer-content-wrapper")).toBeHidden();

  const cellEditDurations: number[] = [];
  const cellEditEventSamples: Array<number | null> = [];
  const cellEditPaintSamples: number[] = [];
  const activeRow = page
    .locator(".register-table-tabs .ant-tabs-content-active")
    .locator('[data-row-key="perf--0001"]');
  const activeHolder = page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody-virtual-holder",
  );
  await activeHolder.evaluate((element) => {
    (element as HTMLElement).scrollTop = 0;
  });
  await expect(activeRow).toBeVisible();
  for (const [index, value] of ["AAAA", "AAAB", "AAAC"].entries()) {
    await activeRow.locator('[data-register-cell="data"]').click();
    const input = activeRow.locator('input[data-register-cell="data"]');
    await input.fill(value);
    await settleFrames(page);
    const editStart = await interactionMark(page);
    await page.keyboard.press("Enter");
    await expect(activeRow.locator('[data-register-cell="data"]')).toHaveText(
      value,
    );
    const durations = await eventDurationsSince(page, editStart);
    const eventDuration = durations.length > 0 ? Math.max(...durations) : null;
    const paintDuration = await page.evaluate((start) => {
      const state = window.__mamepProductionPerf;
      if (!state.eventTimingSupported)
        throw new Error("Event Timing is unavailable");
      const sample = state.keyPaintSamples.find(
        (entry) => entry.startTime >= start,
      );
      if (sample === undefined)
        throw new Error("Real Enter-to-paint sample missing");
      return sample.duration;
    }, editStart);
    expect(
      paintDuration,
      `cell edit ${index + 1}: measured paint duration`,
    ).toBeGreaterThan(0);
    cellEditEventSamples.push(eventDuration);
    cellEditPaintSamples.push(paintDuration);
    cellEditDurations.push(Math.max(eventDuration ?? 0, paintDuration));
  }

  await page
    .locator(".mamep-header")
    .getByRole("button", { name: /^Settings$/ })
    .click();
  const importSettings = page
    .locator(".ant-drawer")
    .filter({ hasText: "Import Workspace" });
  await expect(importSettings.getByText("Reset Workspace")).toBeVisible();
  const chooserPromise = page.waitForEvent("filechooser");
  const importParseStart = await interactionMark(page);
  await importSettings
    .getByRole("button", { name: "Import Workspace" })
    .click();
  const chooser = await chooserPromise;
  const sheet = workspace.sheets[0];
  if (sheet === undefined || sheet.rows[0] === undefined) {
    throw new Error("import fixture missing");
  }
  sheet.rows = buildRows(sheet.rows[0], "import-");
  await chooser.setFiles({
    name: "workspace-1000.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(workspace), "utf8"),
  });
  const preview = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Format version" });
  await expect(preview).toBeVisible({ timeout: 10_000 });
  const importParseEventDurations = await eventDurationsSince(
    page,
    importParseStart,
  );
  const importParseEventMs = Math.max(0, ...importParseEventDurations);
  const importRenderProbe = page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        let started: number | null = null;
        const deadline = performance.now() + 10_000;
        document.addEventListener(
          "click",
          (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const button = target.closest("button");
            if (button?.textContent?.trim() !== "Import") return;
            started = performance.now();
            const tick = (): void => {
              if (
                document.querySelector('[data-row-key^="perf-import-"]') !==
                  null &&
                started !== null
              ) {
                resolve(performance.now() - started);
              } else if (performance.now() > deadline) {
                reject(new Error("imported table did not render"));
              } else {
                requestAnimationFrame(tick);
              }
            };
            requestAnimationFrame(tick);
          },
          { capture: true },
        );
      }),
  );
  const importCommitStart = await interactionMark(page);
  await preview.getByRole("button", { name: "Import", exact: true }).click();
  const importRenderMs = await importRenderProbe;
  const importCommitEventDurations = await eventDurationsSince(
    page,
    importCommitStart,
  );
  const importCommitEventMs = Math.max(0, ...importCommitEventDurations);
  const cellEditMedianMs = median(cellEditDurations);
  const firstScreen = {
    requestCount: firstScreenSample.requestCount,
    transferBytes: firstScreenSample.transferBytes,
    maxChunkBytes: firstScreenSample.maxChunkBytes,
  };
  const interactionApproxInpMs = Math.max(
    settingsEventMs,
    cellEditMedianMs,
    importParseEventMs,
    importCommitEventMs,
  );
  const metrics = {
    hotRestoreMs,
    pageInteractiveMs,
    hotRestoreSamples,
    workspaceRestoreLongTaskMaxMs,
    startupLongTaskMaxMs,
    firstScreen,
    scrollJumpMs: scrollMetrics.scrollMs,
    scrollControlsReadyMs: scrollMetrics.controlsReadyMs,
    scrollLongTaskMaxMs: scrollMetrics.longTaskMaxMs,
    scrollLongTasks: scrollMetrics.longTasks,
    settings: {
      firstOpenWallMs: settingsWallMs,
      eventTimingMs: settingsEventMs,
      eventSampleCount: settingsEventDurations.length,
    },
    cellEdit: {
      eventTimingSamplesMs: cellEditEventSamples,
      keyToPaintUpperBoundSamplesMs: cellEditPaintSamples,
      budgetSamplesMs: cellEditDurations,
      responseMedianMs: cellEditMedianMs,
    },
    import: {
      parseEventTimingMs: importParseEventMs,
      parseEventSampleCount: importParseEventDurations.length,
      commitEventTimingMs: importCommitEventMs,
      commitEventSampleCount: importCommitEventDurations.length,
      renderMs: importRenderMs,
    },
    interactionApproxInpMs,
  };
  const budget = WEB_PERF_BUDGETS.playwright;
  const checks: BudgetCheck[] = [
    maxBudgetCheck(
      "playwright.firstInteractiveMs",
      pageInteractiveMs,
      budget.firstInteractiveMs,
      "ms",
    ),
    maxBudgetCheck(
      "playwright.hotRestoreMs",
      hotRestoreMs,
      budget.hotRestoreMs,
      "ms",
    ),
    maxBudgetCheck(
      "playwright.workspaceRestoreLongTaskMs",
      workspaceRestoreLongTaskMaxMs,
      budget.workspaceRestoreLongTaskMs,
      "ms",
    ),
    maxBudgetCheck(
      "playwright.firstScreen.requestCount",
      firstScreen.requestCount,
      budget.firstScreenRequestCount,
      "count",
    ),
    maxBudgetCheck(
      "playwright.firstScreen.transferBytes",
      firstScreen.transferBytes,
      budget.firstScreenTransferBytes,
      "bytes",
    ),
    maxBudgetCheck(
      "playwright.firstScreen.maxChunkBytes",
      firstScreen.maxChunkBytes,
      budget.firstScreenMaxChunkBytes,
      "bytes",
    ),
    maxBudgetCheck(
      "playwright.scrollJumpMs",
      scrollMetrics.scrollMs,
      budget.scrollJumpMs,
      "ms",
    ),
    maxBudgetCheck(
      "playwright.scrollLongTaskMs",
      scrollMetrics.longTaskMaxMs,
      budget.scrollLongTaskMs,
      "ms",
    ),
    maxBudgetCheck(
      "playwright.settingsFirstOpenEventMs",
      settingsEventMs,
      budget.settingsEventMs,
      "ms",
    ),
    maxBudgetCheck(
      "playwright.cellEditMedianMs",
      cellEditMedianMs,
      budget.cellEditMedianMs,
      "ms",
    ),
    maxBudgetCheck(
      "playwright.importParseEventMs",
      importParseEventMs,
      budget.interactionEventMs,
      "ms",
    ),
    maxBudgetCheck(
      "playwright.importCommitEventMs",
      importCommitEventMs,
      budget.interactionEventMs,
      "ms",
    ),
    maxBudgetCheck(
      "playwright.importRenderMs",
      importRenderMs,
      budget.importRenderMs,
      "ms",
    ),
    maxBudgetCheck(
      "playwright.interactionApproxInpMs",
      interactionApproxInpMs,
      budget.interactionEventMs,
      "ms",
    ),
  ];
  await finishPerformanceReport(testInfo, {
    name: "playwright-workspace",
    metrics: {
      baseUrl: "http://localhost:4173/",
      rowCount: ROW_COUNT,
      ...metrics,
      inpApprox: {
        valueMs: interactionApproxInpMs,
        method:
          "Event Timing with measured Enter-to-paint upper bounds for cell edits",
        isFieldData: false,
      },
    },
    budgetChecks: checks,
    notes: [
      "测试工作区由本地确定性构造的 1000 行配置组成，不包含设备报文或真实用户工作区。",
      "INP 为 Playwright 实验室 Event Timing 近似值，不是字段数据。",
      "Cell edits also measure real Enter-to-paint upper bounds. The budget uses the larger measured duration; null Event Timing samples are never treated as zero.",
    ],
  });
});
