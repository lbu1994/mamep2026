import { expect, test, type Page } from "@playwright/test";

const ROW_COUNT = 1000;
const HOT_RESTORE_BUDGET_MS = 300;
const IMPORT_RENDER_BUDGET_MS = 300;
const SCROLL_JUMP_BUDGET_MS = 100;
const SCROLL_LONG_TASK_BUDGET_MS = 50;

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];
  if (value === undefined) throw new Error("median requires samples");
  return value;
}

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
    (next) =>
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

test("1000 行恢复、导入与滚动达到生产性能预算", async ({ page }) => {
  await page.addInitScript(() => {
    const state: ProductionPerfState = { longTasks: [] };
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
  });

  const workspace = await seedWorkspace(page);
  const hotRestoreSamples: number[] = [];
  const pageInteractiveSamples: number[] = [];
  const workspaceRestoreLongTaskSamples: number[] = [];
  const startupLongTaskSamples: number[] = [];
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
  expect(hotRestoreMs).toBeLessThanOrEqual(HOT_RESTORE_BUDGET_MS);
  expect(workspaceRestoreLongTaskMaxMs).toBeLessThanOrEqual(
    SCROLL_LONG_TASK_BUDGET_MS,
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
    return performance.now() - started;
  });
  await page.waitForTimeout(480);
  const scrollLongTaskMaxMs = await page.evaluate(() =>
    Math.max(
      0,
      ...window.__mamepProductionPerf.longTasks.map((entry) => entry.duration),
    ),
  );
  expect(scrollMetrics).toBeLessThanOrEqual(SCROLL_JUMP_BUDGET_MS);
  expect(scrollLongTaskMaxMs).toBeLessThanOrEqual(SCROLL_LONG_TASK_BUDGET_MS);

  await page.getByRole("button", { name: /Settings/ }).click();
  const settings = page
    .locator(".ant-drawer")
    .filter({ hasText: "Import Workspace" });
  const chooserPromise = page.waitForEvent("filechooser");
  await settings.getByRole("button", { name: "Import Workspace" }).click();
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
  await preview.getByRole("button", { name: "Import", exact: true }).click();
  const importRenderMs = await importRenderProbe;
  expect(importRenderMs).toBeLessThanOrEqual(IMPORT_RENDER_BUDGET_MS);
  const metrics = {
    hotRestoreMs,
    pageInteractiveMs,
    hotRestoreSamples,
    workspaceRestoreLongTaskMaxMs,
    startupLongTaskMaxMs,
    scrollJumpMs: scrollMetrics,
    scrollLongTaskMaxMs,
    importRenderMs,
  };
  console.log(`[performance-production] ${JSON.stringify(metrics)}`);
  await test.info().attach("performance-production.json", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
});
