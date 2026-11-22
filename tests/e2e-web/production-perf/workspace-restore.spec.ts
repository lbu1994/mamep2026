import type { Page } from "@playwright/test";
import { expect, test } from "../tests/fixtures";
import { WEB_PERF_BUDGETS } from "./budgets";
import {
  finishPerformanceReport,
  maxBudgetCheck,
  median,
  type BudgetCheck,
} from "./performance-report";

const ROW_COUNT = 1000;

interface StoredRow {
  rowId: string;
  order: number;
  name: string;
  comment: string;
  addressDraft: string;
  addressValue: number | null;
  cellText: string;
  registerValues: number[] | null;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
}

interface StoredWorkspace {
  activeSheetId: string | null;
  sheets: Array<{
    sheetId: string;
    rows: StoredRow[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

interface ProductionPerfState {
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

async function readWorkspace(page: Page): Promise<StoredWorkspace> {
  const raw = await page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("mamep2026", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("kv");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction("kv", "readonly")
            .objectStore("kv")
            .get("workspace");
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
        };
      }),
  );
  if (typeof raw !== "object" || raw === null) {
    throw new Error("persisted workspace missing");
  }
  return raw as StoredWorkspace;
}

async function writeWorkspace(
  page: Page,
  workspace: StoredWorkspace,
): Promise<void> {
  await page.evaluate(
    (next: StoredWorkspace) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("mamep2026", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("kv");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("kv", "readwrite");
          tx.objectStore("kv").put(next, "workspace");
          tx.objectStore("kv").delete("workspace-backup");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    workspace,
  );
}

function buildRows(template: StoredRow, prefix: string): StoredRow[] {
  const now = Date.now();
  return Array.from({ length: ROW_COUNT }, (_, index) => ({
    ...template,
    rowId: `perf-${prefix}-${String(index + 1).padStart(4, "0")}`,
    order: index + 1,
    name: `Perf ${prefix} ${String(index + 1).padStart(4, "0")}`,
    comment: "",
    addressDraft: String(index),
    addressValue: index,
    cellText: (index % 0x10000).toString(16).padStart(4, "0").toUpperCase(),
    registerValues: [index],
    createdAt: now,
    updatedAt: now,
  }));
}

async function seedWorkspace(page: Page): Promise<StoredWorkspace> {
  await page.goto("http://localhost:4173/");
  await page.locator(".register-table-tabs [data-row-key]").first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await expect
    .poll(async () => {
      try {
        return (await readWorkspace(page)).sheets.length > 0;
      } catch {
        return false;
      }
    })
    .toBe(true);
  const workspace = await readWorkspace(page);
  const sheet = workspace.sheets[0];
  if (sheet === undefined || sheet.rows[0] === undefined) {
    throw new Error("default workspace has no sheet/row template");
  }
  sheet.rows = buildRows(sheet.rows[0], "");
  workspace.activeSheetId = sheet.sheetId;
  await writeWorkspace(page, workspace);
  return workspace;
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
      longTasks: [],
      interactionEvents: [],
    };
    window.__mamepProductionPerf = state;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // 浏览器不支持 longtask 时保留其余性能断言。
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
      if (await close.isVisible()) await close.click();
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
    await new Promise<void>((resolve) => {
      let previousCount = -1;
      let quietFrames = 0;
      const tick = (): void => {
        if (state.longTasks.length === previousCount) {
          quietFrames += 1;
        } else {
          previousCount = state.longTasks.length;
          quietFrames = 0;
        }
        if (quietFrames >= 2) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return {
      scrollMs,
      longTaskMaxMs: Math.max(
        0,
        ...state.longTasks.map((entry) => entry.duration),
      ),
    };
  });

  const settingsStart = await interactionMark(page);
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
    const eventDuration = Math.max(0, ...durations);
    if (eventDuration === 0) {
      throw new Error(`cell edit ${index + 1}: no Event Timing entry`);
    }
    cellEditDurations.push(eventDuration);
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
    scrollLongTaskMaxMs: scrollMetrics.longTaskMaxMs,
    settings: {
      firstOpenWallMs: settingsWallMs,
      eventTimingMs: settingsEventMs,
      eventSampleCount: settingsEventDurations.length,
    },
    cellEdit: {
      eventTimingSamplesMs: cellEditDurations,
      eventTimingMedianMs: cellEditMedianMs,
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
        method: "max of measured Event Timing durations",
        isFieldData: false,
      },
    },
    budgetChecks: checks,
    notes: [
      "测试工作区由本地确定性构造的 1000 行配置组成，不包含设备报文或真实用户工作区。",
      "INP 为 Playwright 实验室 Event Timing 近似值，不是字段数据。",
    ],
  });
});
