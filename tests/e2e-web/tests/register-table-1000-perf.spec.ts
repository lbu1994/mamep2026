/**
 * 1000 行寄存器表性能验收（mockTransport=1，真实系统 Edge）。
 *
 * 覆盖：
 * - 普通表启用虚拟滚动：1000 行首屏可交互、跳转末尾、单元格编辑、选择、新增、
 *   标签页切换与 IndexedDB 自动保存；
 * - 范围行/位明细 tree 数据经 antd v6 扁平化后继续虚拟渲染：1000 个父行仍可
 *   滚动，展开派生行不阻断交互；
 * - 行高、行键与显示数据一致，离屏行 DOM 数量有界；
 * - 多次滚动/切页后 GC 后堆与 DOM 节点无明显长期增长。
 *
 * 性能数据写入 Playwright 附件；普通单元格 Event Timing 中位数固定验收 ≤100ms。
 * 首屏采用 5s 开发环境灾难阈值并记录实际值，生产 3s 目标由独立构建基线约束。
 */
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";

test.describe.configure({ timeout: 90_000 });

const BASE_URL = "http://localhost:5173/?mockTransport=1";
const ROW_COUNT = 1000;
const DESKTOP_ROW_HEIGHT = 29;
const CELL_COMMIT_BUDGET_MS = 100;
// dev server + React StrictMode 的实验室噪声高于生产目标；用例记录该值，
// 并以 5s 捕获“基本不可交互”的灾难性回归。生产性能门禁由独立基线任务约束。
const FIRST_INTERACTIVE_BUDGET_MS = 5000;
const TREE_EXPAND_BUDGET_MS = 1000;
const TREE_INTERACTION_LONG_TASK_BUDGET_MS = 500;

interface StoredRow {
  rowId: string;
  order: number;
  name: string;
  comment: string;
  addressDraft: string;
  addressValue: number | null;
  registerCount: number;
  dataType: string;
  pollingEnabled: boolean;
  traceEnabled: boolean;
  cellText: string;
  registerValues: number[] | null;
  registers: Array<{
    name: string;
    comment: string;
    dataType: string;
  }> | null;
  bitComments: Array<string[] | null> | null;
  bitNames: Array<string[] | null> | null;
  createdAt: number;
  updatedAt: number;
}

interface StoredSheet {
  sheetId: string;
  name: string;
  order: number;
  open: boolean;
  rows: StoredRow[];
  [key: string]: unknown;
}

interface StoredWorkspace {
  activeSheetId: string | null;
  sheets: StoredSheet[];
  [key: string]: unknown;
}

interface BrowserPerfState {
  firstInteractiveAt: number | null;
  longTasks: Array<{ startTime: number; duration: number }>;
}

interface CdpPerformanceMetric {
  name: string;
  value: number;
}

function mainSheet(workspace: StoredWorkspace): StoredSheet {
  const sheet = workspace.sheets[0];
  if (sheet === undefined) throw new Error("seeded workspace has no sheet");
  return sheet;
}

function rowName(prefix: string, index: number): string {
  return `Perf ${prefix} ${String(index + 1).padStart(4, "0")}`;
}

function rowId(prefix: string, index: number): string {
  return `perf-${prefix}-${String(index + 1).padStart(4, "0")}`;
}

function rowData(index: number): string {
  return (index % 0x10000).toString(16).padStart(4, "0").toUpperCase();
}

/** 构造普通 1000 行；每行 Name/Address/Data 有可交叉校验的唯一组合。 */
function buildRows(prefix: string, count: number): StoredRow[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => ({
    rowId: rowId(prefix, index),
    order: index + 1,
    name: rowName(prefix, index),
    comment: "",
    addressDraft: String(index),
    addressValue: index,
    registerCount: 1,
    dataType: "hex",
    pollingEnabled: false,
    traceEnabled: false,
    cellText: rowData(index),
    registerValues: [index],
    registers: null,
    bitComments: null,
    bitNames: null,
    createdAt: now,
    updatedAt: now,
  }));
}

function cloneSheet(
  template: StoredSheet,
  id: string,
  name: string,
  order: number,
  rows: StoredRow[],
): StoredSheet {
  return {
    ...template,
    sheetId: id,
    name,
    order,
    open: true,
    rows,
    columnWidths: {},
    columnOrder: null,
  };
}

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15_000,
  });
}

async function readWorkspaceMain(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("mamep2026", 1);
        open.onupgradeneeded = () => {
          open.result.createObjectStore("kv");
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("kv", "readonly");
          const get = tx.objectStore("kv").get("workspace");
          get.onerror = () => {
            db.close();
            reject(get.error);
          };
          get.onsuccess = () => {
            db.close();
            resolve(get.result);
          };
        };
      }),
  );
}

async function writeWorkspaceMain(
  page: Page,
  workspace: StoredWorkspace,
): Promise<void> {
  await page.evaluate(
    (nextWorkspace) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("mamep2026", 1);
        open.onupgradeneeded = () => {
          open.result.createObjectStore("kv");
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("kv", "readwrite");
          const store = tx.objectStore("kv");
          store.put(nextWorkspace, "workspace");
          store.delete("workspace-backup");
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    workspace,
  );
}

/**
 * 先用应用自身生成合法默认工作区，再按持久化形态替换为测试数据。
 * 轮询事实源而非固定 sleep，避免与 IndexedDB 初始化/自动保存竞态。
 */
async function seedWorkspace(
  page: Page,
  mutate: (workspace: StoredWorkspace) => void,
): Promise<void> {
  await openApp(page);
  await expect
    .poll(async () => (await readWorkspaceMain(page)) !== undefined, {
      timeout: 5000,
    })
    .toBe(true);
  const raw = await readWorkspaceMain(page);
  if (typeof raw !== "object" || raw === null) {
    throw new Error("default workspace was not persisted");
  }
  const workspace = structuredClone(raw) as StoredWorkspace;
  mutate(workspace);
  await writeWorkspaceMain(page, workspace);
}

/** 在应用脚本前安装首屏可交互与长任务观察器；每个 page navigation 自动重建。 */
async function installPerfObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state: BrowserPerfState = {
      firstInteractiveAt: null,
      longTasks: [],
    };
    Object.defineProperty(window, "__mamepPerf", {
      value: state,
      configurable: true,
    });

    const markInteractive = (): void => {
      if (state.firstInteractiveAt !== null) return;
      const active = document.querySelector(
        ".register-table-tabs .ant-tabs-content-active",
      );
      const row = active?.querySelector<HTMLElement>("[data-row-key^='perf-']");
      const dataCell = row?.querySelector<HTMLElement>(
        '[data-register-cell="data"]',
      );
      if (
        row !== undefined &&
        row !== null &&
        dataCell !== undefined &&
        dataCell !== null &&
        row.getBoundingClientRect().height > 0
      ) {
        state.firstInteractiveAt = performance.now();
      }
    };

    const observer = new MutationObserver(markInteractive);
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    requestAnimationFrame(markInteractive);

    try {
      const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      });
      longTaskObserver.observe({ type: "longtask", buffered: true });
    } catch {
      // 浏览器不支持 longtask 时仍保留首屏和交互耗时断言。
    }
  });
}

/**
 * 时间点/计时均来自页面 performance.now()，避免把 Playwright 协议往返
 * 误算进 UI 处理耗时。
 */
async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

async function getPerfState(page: Page): Promise<BrowserPerfState> {
  return page.evaluate(() => {
    const state = (window as unknown as { __mamepPerf?: BrowserPerfState })
      .__mamepPerf;
    if (state === undefined) throw new Error("performance observer missing");
    return {
      firstInteractiveAt: state.firstInteractiveAt,
      longTasks: [...state.longTasks],
    };
  });
}

async function resetLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as unknown as { __mamepPerf?: BrowserPerfState })
      .__mamepPerf;
    if (state !== undefined) state.longTasks.length = 0;
  });
}

function activeWorkspace(page: Page) {
  return page.locator(".register-table-tabs .ant-tabs-content-active").first();
}

function activeRow(page: Page, key: string) {
  return activeWorkspace(page).locator(`[data-row-key="${key}"]`);
}

async function expectRowTriple(
  page: Page,
  key: string,
  name: string,
  address: string,
  data: string,
): Promise<void> {
  const row = activeRow(page, key);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row.locator('[data-register-cell="name"]')).toHaveText(name);
  await expect(row.locator('[data-register-cell="address"]')).toHaveText(
    address,
  );
  await expect(row.locator('[data-register-cell="data"]')).toHaveText(data);
  const height = await row.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(Math.abs(height - DESKTOP_ROW_HEIGHT)).toBeLessThanOrEqual(1);
}

/** 在页面内滚动到目标行并等待其进入可见区域，返回 scrollTop 设置到可见耗时。 */
async function scrollToRow(page: Page, key: string, toBottom: boolean) {
  return page.evaluate(
    async ({ targetKey, bottom }) => {
      const active = document.querySelector(
        ".register-table-tabs .ant-tabs-content-active",
      );
      const holder = active?.querySelector<HTMLElement>(
        ".ant-table-tbody-virtual-holder, .ant-table-body",
      );
      if (holder === null || holder === undefined) {
        throw new Error("table scroll container missing");
      }
      const started = performance.now();
      holder.scrollTop = bottom ? holder.scrollHeight : 0;

      await new Promise<void>((resolve, reject) => {
        const deadline = started + 3000;
        const tick = (): void => {
          const row = document.querySelector<HTMLElement>(
            `.register-table-tabs .ant-tabs-content-active [data-row-key="${targetKey}"]`,
          );
          if (
            row !== null &&
            row.getBoundingClientRect().height > 0 &&
            row.getBoundingClientRect().bottom > 0
          ) {
            resolve();
            return;
          }
          if (performance.now() > deadline) {
            reject(new Error(`row ${targetKey} did not become visible`));
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return performance.now() - started;
    },
    { targetKey: key, bottom: toBottom },
  );
}

/**
 * 提交 Data：填充由 Playwright 完成，Enter→重渲染由页面内计时。
 * 同时返回提交后焦点位置，验收不得把焦点跳到其他行。
 */
async function commitDataCell(
  page: Page,
  key: string,
  value: string,
): Promise<{
  commitMs: number;
  eventDurationMs: number;
  focusedRowKey: string | null;
  focusedTag: string;
}> {
  const row = activeRow(page, key);
  const dataCell = row.locator('[data-register-cell="data"]');
  await dataCell.click();
  const input = row.locator('input[data-register-cell="data"]');
  await input.fill(value);
  // fill 的 React onChange 渲染完成后再开始计时，确保被测对象是 Enter 提交本身。
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(
    ({ expected, rowKey }) => {
      const started = performance.now();
      const root = document.querySelector(
        ".register-table-tabs .ant-tabs-content-active",
      );
      if (root === null) throw new Error("active table missing");
      const committed = (): boolean => {
        const targetRow = document.querySelector(
          `.register-table-tabs .ant-tabs-content-active [data-row-key="${rowKey}"]`,
        );
        const currentInput = targetRow?.querySelector<HTMLInputElement>(
          'input[data-register-cell="data"]',
        );
        const cell = targetRow?.querySelector<HTMLElement>(
          '[data-register-cell="data"]',
        );
        return (
          currentInput === null &&
          cell !== null &&
          cell !== undefined &&
          cell.textContent?.includes(expected) === true
        );
      };
      const commitMs = new Promise<number>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          observer.disconnect();
          reject(new Error("Data cell commit did not render"));
        }, 1000);
        const observer = new MutationObserver(() => {
          if (!committed()) return;
          observer.disconnect();
          window.clearTimeout(timeout);
          resolve(performance.now() - started);
        });
        observer.observe(root, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });
      const eventDuration = new Promise<number>((resolve) => {
        const fallback = window.setTimeout(
          () => resolve(performance.now() - started),
          1000,
        );
        const observer = new PerformanceObserver((list) => {
          const event = list
            .getEntries()
            .find(
              (entry) =>
                entry.entryType === "event" &&
                entry.name === "keydown" &&
                entry.startTime >= started,
            );
          if (event === undefined) return;
          observer.disconnect();
          window.clearTimeout(fallback);
          resolve(event.duration);
        });
        observer.observe({
          type: "event",
          durationThreshold: 16,
        } as PerformanceObserverInit & { durationThreshold: number });
      });
      (
        window as unknown as {
          __mamepCommitProbe?: {
            commitMs: Promise<number>;
            eventDuration: Promise<number>;
          };
        }
      ).__mamepCommitProbe = { commitMs, eventDuration };
    },
    { expected: value, rowKey: key },
  );
  try {
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
  } finally {
    await cdp.detach();
  }
  return page.evaluate(async () => {
    const probe = (
      window as unknown as {
        __mamepCommitProbe?: {
          commitMs: Promise<number>;
          eventDuration: Promise<number>;
        };
      }
    ).__mamepCommitProbe;
    if (probe === undefined) throw new Error("commit probe missing");
    const [commitMs, eventDurationMs] = await Promise.all([
      probe.commitMs,
      probe.eventDuration,
    ]);
    // 焦点恢复是提交后的 passive effect；单等一帧再读取，但不把一个额外帧算入提交耗时。
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    const focused = document.activeElement;
    return {
      commitMs,
      eventDurationMs,
      focusedRowKey:
        focused instanceof Element
          ? (focused.closest("[data-row-key]")?.getAttribute("data-row-key") ??
            null)
          : null,
      focusedTag: focused?.tagName ?? "NONE",
    };
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const current = sorted[middle];
  if (current === undefined) throw new Error("median requires one value");
  if (sorted.length % 2 === 1) return current;
  const previous = sorted[middle - 1];
  if (previous === undefined) throw new Error("median value missing");
  return (previous + current) / 2;
}

async function collectRuntimeMetrics(
  page: Page,
  sampleCount = 1,
): Promise<{
  heapBytes: number;
  nodes: number;
}> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Performance.enable");
    let best: { heapBytes: number; nodes: number } | null = null;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      // 虚拟表切页后仍有 useAfterFirstPaint 延迟挂载的单元格控件。每个样本都等待
      // 两帧让 React 提交，再 GC；多次取最小值可过滤单帧节点池扩张，同时保留对
      // 稳态持续增长的检测能力。
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await cdp.send("HeapProfiler.collectGarbage");
      const response = (await cdp.send("Performance.getMetrics")) as {
        metrics: CdpPerformanceMetric[];
      };
      const value = (name: string): number =>
        response.metrics.find((metric) => metric.name === name)?.value ?? 0;
      const current = {
        heapBytes: value("JSHeapUsedSize"),
        nodes: value("Nodes"),
      };
      if (best === null || current.nodes < best.nodes) best = current;
    }
    if (best === null) throw new Error("no runtime metrics collected");
    return best;
  } finally {
    await cdp.detach();
  }
}

async function attachMetrics(
  testInfo: TestInfo,
  name: string,
  metrics: Record<string, unknown>,
): Promise<void> {
  const payload = {
    generatedAt: new Date().toISOString(),
    environment: {
      browser: testInfo.project.name,
      viewport: testInfo.project.use.viewport,
      baseUrl: BASE_URL,
      rowCount: ROW_COUNT,
      transport: "mock",
    },
    ...metrics,
  };
  console.log(`[${name}] ${JSON.stringify(payload)}`);
  await testInfo.attach(`${name}.json`, {
    body: JSON.stringify(payload, null, 2),
    contentType: "application/json",
  });
}

test("1000 行普通表：虚拟滚动下编辑、选择、新增、切页与自动保存保持数据一致", async ({
  page,
}, testInfo) => {
  await seedWorkspace(page, (workspace) => {
    const template = mainSheet(workspace);
    const main = cloneSheet(
      template,
      "perf-main-sheet",
      "Perf Main",
      0,
      buildRows("main", ROW_COUNT),
    );
    const small = cloneSheet(
      template,
      "perf-small-sheet",
      "Perf Small",
      1,
      buildRows("small", 3),
    );
    workspace.sheets = [main, small];
    workspace.activeSheetId = main.sheetId;
  });

  await installPerfObserver(page);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15_000,
  });
  await expect(activeRow(page, rowId("main", 0))).toBeVisible();
  const perfAfterLoad = await getPerfState(page);
  expect(perfAfterLoad.firstInteractiveAt).not.toBeNull();
  expect(perfAfterLoad.firstInteractiveAt ?? Infinity).toBeLessThanOrEqual(
    FIRST_INTERACTIVE_BUDGET_MS,
  );

  // 普通 1000 行表必须启用虚拟滚动：仅保留有界 DOM 行，行高固定为 29px。
  await expect(
    activeWorkspace(page).locator(".ant-table-tbody-virtual-holder"),
  ).toHaveCount(1);
  await expectRowTriple(
    page,
    rowId("main", 0),
    rowName("main", 0),
    "0",
    rowData(0),
  );
  const renderedRowsAtTop = await activeWorkspace(page)
    .locator("[data-row-key]")
    .count();
  expect(renderedRowsAtTop).toBeGreaterThan(0);
  expect(renderedRowsAtTop).toBeLessThan(100);

  await resetLongTasks(page);
  const scrollToBottomMs = await scrollToRow(page, rowId("main", 999), true);
  // 开发模式严格双渲染与 Vite 的绝对耗时只记录；生产目标由独立生产用例强制断言。
  // 此处仍统计滚动窗口长任务，作为开发环境回归信号。
  await page.waitForTimeout(480);
  const scrollPerformance = await getPerfState(page);
  const scrollLongTaskMaxMs = Math.max(
    0,
    ...scrollPerformance.longTasks.map((entry) => entry.duration),
  );
  expect(scrollToBottomMs).toBeLessThan(500);
  expect(scrollLongTaskMaxMs).toBeLessThan(500);
  await expectRowTriple(
    page,
    rowId("main", 999),
    rowName("main", 999),
    "999",
    rowData(999),
  );

  // 末尾单元格提交：验证离屏卸载/重挂载后行数据没有错位。
  const bottomCommit = await commitDataCell(page, rowId("main", 999), "BEEF");
  expect(bottomCommit.focusedRowKey).toBe(rowId("main", 999));
  await expect(
    activeRow(page, rowId("main", 999)).locator('[data-register-cell="data"]'),
  ).toHaveText("BEEF");
  const bottomCommitRepeat1 = await commitDataCell(
    page,
    rowId("main", 999),
    "BEE1",
  );
  const bottomCommitRepeat2 = await commitDataCell(
    page,
    rowId("main", 999),
    "BEE2",
  );
  for (const result of [bottomCommitRepeat1, bottomCommitRepeat2]) {
    expect(result.focusedRowKey).toBe(rowId("main", 999));
  }

  await scrollToRow(page, rowId("main", 0), false);
  const topCommit = await commitDataCell(page, rowId("main", 0), "CAFE");
  expect(topCommit.focusedRowKey).toBe(rowId("main", 0));
  await expectRowTriple(
    page,
    rowId("main", 0),
    rowName("main", 0),
    "0",
    "CAFE",
  );
  const commitSamples = [
    bottomCommit.commitMs,
    bottomCommitRepeat1.commitMs,
    bottomCommitRepeat2.commitMs,
    topCommit.commitMs,
  ];
  const eventDurationSamples = [
    bottomCommit.eventDurationMs,
    bottomCommitRepeat1.eventDurationMs,
    bottomCommitRepeat2.eventDurationMs,
    topCommit.eventDurationMs,
  ];
  // 保留中位数作为目标验收：单帧浏览器调度抖动不等于持续响应退化。
  const commitMedianMs = median(commitSamples);
  const eventDurationMedianMs = median(eventDurationSamples);
  expect(eventDurationMedianMs).toBeLessThanOrEqual(CELL_COMMIT_BUDGET_MS);
  expect(Math.max(...commitSamples)).toBeLessThanOrEqual(250);

  // 选择：勾选首两行，确认选择状态只出现在对应行。
  const firstCheckbox = activeRow(page, rowId("main", 0)).locator(
    '.ant-table-selection-column input[type="checkbox"]',
  );
  const secondCheckbox = activeRow(page, rowId("main", 1)).locator(
    '.ant-table-selection-column input[type="checkbox"]',
  );
  await firstCheckbox.check();
  await secondCheckbox.check();
  await expect(firstCheckbox).toBeChecked();
  await expect(secondCheckbox).toBeChecked();

  // 新增：追加到末尾后，行总数与自动保存事实源都必须为 1001。
  const addStarted = await pageNow(page);
  await page
    .getByRole("button", { name: /Add Row/ })
    .evaluate((element) => (element as HTMLElement).click());
  await expect(page.locator(".table-toolbar__info").last()).toContainText(
    "1001",
    {
      timeout: 5000,
    },
  );
  const addRowMs = (await pageNow(page)) - addStarted;

  // 标签页切换：小表与 1000 行表之间往返，切回后已提交数据仍在。
  await resetLongTasks(page);
  const switchToSmallStarted = await pageNow(page);
  await page.getByRole("tab", { name: "Perf Small", exact: true }).click();
  await expect(activeRow(page, rowId("small", 0))).toBeVisible();
  const switchToSmallMs = (await pageNow(page)) - switchToSmallStarted;
  const switchBackStarted = await pageNow(page);
  await page.getByRole("tab", { name: "Perf Main", exact: true }).click();
  await expect(activeRow(page, rowId("main", 0))).toBeVisible();
  await expect(
    activeRow(page, rowId("main", 0)).locator('[data-register-cell="data"]'),
  ).toHaveText("CAFE");
  const switchBackMs = (await pageNow(page)) - switchBackStarted;

  // 自动保存：轮询 IndexedDB，直到新增行数和两处单元格修改全部落盘。
  const autosaveStarted = await pageNow(page);
  await expect
    .poll(
      async () => {
        const raw = await readWorkspaceMain(page);
        if (typeof raw !== "object" || raw === null) return null;
        const workspace = raw as StoredWorkspace;
        const rows = mainSheet(workspace).rows;
        return {
          count: rows.length,
          firstData: rows[0]?.cellText ?? null,
          lastData: rows[999]?.cellText ?? null,
        };
      },
      { timeout: 10_000 },
    )
    .toEqual({ count: 1001, firstData: "CAFE", lastData: "BEE2" });
  const autosaveMs = (await pageNow(page)) - autosaveStarted;

  // 反复滚动+切页后强制 GC，检查堆和 DOM 节点没有持续累积。
  const memoryBefore = await collectRuntimeMetrics(page, 3);
  for (let cycle = 0; cycle < 6; cycle += 1) {
    await scrollToRow(page, rowId("main", 999), true);
    await scrollToRow(page, rowId("main", 0), false);
    await page.getByRole("tab", { name: "Perf Small", exact: true }).click();
    await expect(activeRow(page, rowId("small", 0))).toBeVisible();
    await page.getByRole("tab", { name: "Perf Main", exact: true }).click();
    await expect(activeRow(page, rowId("main", 0))).toBeVisible();
  }
  const memoryAfterWarmCycles = await collectRuntimeMetrics(page, 3);
  // 第二组循环用于区分虚拟列表一次性节点池扩张与持续泄漏。
  for (let cycle = 0; cycle < 6; cycle += 1) {
    await scrollToRow(page, rowId("main", 999), true);
    await scrollToRow(page, rowId("main", 0), false);
    await page.getByRole("tab", { name: "Perf Small", exact: true }).click();
    await expect(activeRow(page, rowId("small", 0))).toBeVisible();
    await page.getByRole("tab", { name: "Perf Main", exact: true }).click();
    await expect(activeRow(page, rowId("main", 0))).toBeVisible();
  }
  const memoryAfter = await collectRuntimeMetrics(page, 3);
  const renderedRowsAfterCycles = await activeWorkspace(page)
    .locator("[data-row-key]")
    .count();
  expect(renderedRowsAfterCycles).toBeLessThan(100);
  expect(memoryAfter.nodes - memoryAfterWarmCycles.nodes).toBeLessThan(2000);
  expect(memoryAfter.heapBytes - memoryBefore.heapBytes).toBeLessThan(
    16 * 1024 * 1024,
  );

  const cyclePerf = await getPerfState(page);
  const maxCycleLongTaskMs = Math.max(
    0,
    ...cyclePerf.longTasks.map((entry) => entry.duration),
  );

  await attachMetrics(testInfo, "register-table-1000-virtual", {
    startup: {
      firstInteractiveMs: perfAfterLoad.firstInteractiveAt,
      longTaskMaxMs: Math.max(
        0,
        ...perfAfterLoad.longTasks.map((entry) => entry.duration),
      ),
    },
    virtualScrolling: {
      renderedRowsAtTop,
      renderedRowsAfterCycles,
      rowHeightPx: DESKTOP_ROW_HEIGHT,
      scrollToBottomMs,
      scrollLongTaskMaxMs,
    },
    interactions: {
      commitMs: commitSamples,
      commitMedianMs,
      commitMaxMs: Math.max(...commitSamples),
      eventDurationMs: eventDurationSamples,
      eventDurationMedianMs,
      addRowMs,
      switchToSmallMs,
      switchBackMs,
      maxCycleLongTaskMs,
    },
    autosaveMs,
    memory: {
      before: memoryBefore,
      afterWarmCycles: memoryAfterWarmCycles,
      after: memoryAfter,
      heapDeltaBytes: memoryAfter.heapBytes - memoryBefore.heapBytes,
      nodeDelta: memoryAfter.nodes - memoryBefore.nodes,
      steadyNodeDelta: memoryAfter.nodes - memoryAfterWarmCycles.nodes,
    },
  });
});

test("1000 行含范围行：tree 数据兼容虚拟滚动后仍可滚动与展开", async ({
  page,
}, testInfo) => {
  await seedWorkspace(page, (workspace) => {
    const template = mainSheet(workspace);
    const rows = buildRows("range", ROW_COUNT);
    const first = rows[0];
    if (first === undefined) throw new Error("missing range row");
    rows[0] = {
      ...first,
      addressDraft: "0-1",
      registerCount: 2,
      cellText: "0000 0001",
      registerValues: [0, 1],
      registers: [
        { name: "Range Hi", comment: "", dataType: "hex" },
        { name: "Range Lo", comment: "", dataType: "hex" },
      ],
    };
    const main = cloneSheet(
      template,
      "perf-range-sheet",
      "Perf Range",
      0,
      rows,
    );
    workspace.sheets = [main];
    workspace.activeSheetId = main.sheetId;
  });

  await installPerfObserver(page);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15_000,
  });
  await expect(activeRow(page, rowId("range", 0))).toBeVisible({
    timeout: 15_000,
  });
  const startup = await getPerfState(page);
  expect(startup.firstInteractiveAt).not.toBeNull();
  expect(startup.firstInteractiveAt ?? Infinity).toBeLessThanOrEqual(
    FIRST_INTERACTIVE_BUDGET_MS,
  );

  // antd v6 先扁平化 tree children 再走 Virtual BodyGrid；DOM 行数保持有界。
  await expect(
    activeWorkspace(page).locator(".ant-table-tbody-virtual-holder"),
  ).toHaveCount(1);
  expect(
    await activeWorkspace(page).locator("[data-row-key]").count(),
  ).toBeLessThan(100);
  await expectRowTriple(
    page,
    rowId("range", 0),
    rowName("range", 0),
    "0-1",
    "0000 0001",
  );

  await resetLongTasks(page);
  const expandStarted = await pageNow(page);
  await activeRow(page, rowId("range", 0))
    .getByRole("button", { name: "Expand row" })
    .click();
  await expect(
    activeWorkspace(page).locator("[data-row-key*=':c']"),
  ).toHaveCount(2);
  const expandMs = (await pageNow(page)) - expandStarted;
  expect(expandMs).toBeLessThanOrEqual(TREE_EXPAND_BUDGET_MS);
  const interactionPerf = await getPerfState(page);
  const maxLongTaskMs = Math.max(
    0,
    ...interactionPerf.longTasks.map((entry) => entry.duration),
  );
  expect(maxLongTaskMs).toBeLessThanOrEqual(
    TREE_INTERACTION_LONG_TASK_BUDGET_MS,
  );

  const scrollStarted = await pageNow(page);
  await scrollToRow(page, rowId("range", 999), true);
  const scrollToBottomMs = (await pageNow(page)) - scrollStarted;
  await expectRowTriple(
    page,
    rowId("range", 999),
    rowName("range", 999),
    "999",
    rowData(999),
  );

  await attachMetrics(testInfo, "register-table-1000-range", {
    startup: {
      firstInteractiveMs: startup.firstInteractiveAt,
      longTaskMaxMs: Math.max(
        0,
        ...startup.longTasks.map((entry) => entry.duration),
      ),
    },
    treeVirtualMode: {
      renderedParentRows: ROW_COUNT,
      virtualizedDomRows: await activeWorkspace(page)
        .locator("[data-row-key]")
        .count(),
      expandedChildRows: 2,
      expandMs,
      maxLongTaskMs,
      scrollToBottomMs,
    },
  });
});

test("1000 行含位明细：tree 数据兼容虚拟滚动后展开位行仍可操作", async ({
  page,
}, testInfo) => {
  await seedWorkspace(page, (workspace) => {
    const template = mainSheet(workspace);
    const rows = buildRows("bit", ROW_COUNT);
    const first = rows[0];
    if (first === undefined) throw new Error("missing bit row");
    rows[0] = {
      ...first,
      dataType: "binary",
      cellText: "0000 0000 0001",
      registerValues: [1],
    };
    const main = cloneSheet(template, "perf-bit-sheet", "Perf Bit", 0, rows);
    workspace.sheets = [main];
    workspace.activeSheetId = main.sheetId;
  });

  await installPerfObserver(page);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15_000,
  });
  await expect(activeRow(page, rowId("bit", 0))).toBeVisible({
    timeout: 15_000,
  });
  const startup = await getPerfState(page);
  expect(startup.firstInteractiveAt).not.toBeNull();
  expect(startup.firstInteractiveAt ?? Infinity).toBeLessThanOrEqual(
    FIRST_INTERACTIVE_BUDGET_MS,
  );

  // Binary 父行同样由 Virtual BodyGrid 扁平化渲染，DOM 行数保持有界。
  await expect(
    activeWorkspace(page).locator(".ant-table-tbody-virtual-holder"),
  ).toHaveCount(1);
  expect(
    await activeWorkspace(page).locator("[data-row-key]").count(),
  ).toBeLessThan(100);
  await expectRowTriple(
    page,
    rowId("bit", 0),
    rowName("bit", 0),
    "0",
    "0000 0000 0001",
  );

  await resetLongTasks(page);
  const expandStarted = await pageNow(page);
  await activeRow(page, rowId("bit", 0))
    .getByRole("button", { name: "Expand row" })
    .click();
  await expect(
    activeWorkspace(page).locator("[data-row-key*=':b']"),
  ).toHaveCount(16);
  const expandMs = (await pageNow(page)) - expandStarted;
  expect(expandMs).toBeLessThanOrEqual(TREE_EXPAND_BUDGET_MS);
  const interactionPerf = await getPerfState(page);
  const maxLongTaskMs = Math.max(
    0,
    ...interactionPerf.longTasks.map((entry) => entry.duration),
  );
  expect(maxLongTaskMs).toBeLessThanOrEqual(
    TREE_INTERACTION_LONG_TASK_BUDGET_MS,
  );

  const scrollStarted = await pageNow(page);
  await scrollToRow(page, rowId("bit", 999), true);
  const scrollToBottomMs = (await pageNow(page)) - scrollStarted;
  await expectRowTriple(
    page,
    rowId("bit", 999),
    rowName("bit", 999),
    "999",
    rowData(999),
  );

  await attachMetrics(testInfo, "register-table-1000-bit", {
    startup: {
      firstInteractiveMs: startup.firstInteractiveAt,
      longTaskMaxMs: Math.max(
        0,
        ...startup.longTasks.map((entry) => entry.duration),
      ),
    },
    treeVirtualMode: {
      renderedParentRows: ROW_COUNT,
      virtualizedDomRows: await activeWorkspace(page)
        .locator("[data-row-key]")
        .count(),
      expandedBitRows: 16,
      expandMs,
      maxLongTaskMs,
      scrollToBottomMs,
    },
  });
});
