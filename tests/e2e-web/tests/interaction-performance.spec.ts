/**
 * 首次交互 Event Timing 实验室验收（真实系统 Edge + dev server）。
 *
 * Settings / Connection / Add Row / 1000 行导入的输入事件 duration 必须 ≤200ms。
 * 该指标是实验室回归门禁；真实用户 INP 仍需后续 field data 确认。
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const BASE_URL = "http://localhost:5173/?mockTransport=1";
const INTERACTION_BUDGET_MS = 200;

interface EventTimingSample {
  name: string;
  startTime: number;
  duration: number;
  interactionId: number;
}

async function installEventTimingObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const samples: EventTimingSample[] = [];
    const scope = window as unknown as {
      __mamepEventTiming?: EventTimingSample[];
    };
    scope.__mamepEventTiming = samples;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType !== "event") continue;
          const event = entry as PerformanceEntry & {
            interactionId?: number;
          };
          samples.push({
            name: event.name,
            startTime: event.startTime,
            duration: event.duration,
            interactionId: event.interactionId ?? 0,
          });
        }
      }).observe({
        type: "event",
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit & { durationThreshold: number });
    } catch {
      // 不支持 Event Timing 时后续断言会明确失败，不会静默伪造 0ms。
    }
  });
}

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15_000,
  });
}

async function interactionMark(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

async function settleInteraction(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function interactionMetricsSince(
  page: Page,
  startTime: number,
): Promise<EventTimingSample[]> {
  return page.evaluate((start) => {
    const samples = (
      window as unknown as { __mamepEventTiming?: EventTimingSample[] }
    ).__mamepEventTiming;
    return (samples ?? []).filter((sample) => sample.startTime >= start);
  }, startTime);
}

async function expectInteractionBudget(
  page: Page,
  startTime: number,
  label: string,
): Promise<number> {
  await settleInteraction(page);
  const samples = await interactionMetricsSince(page, startTime);
  const maxDuration = Math.max(0, ...samples.map((entry) => entry.duration));
  expect(
    maxDuration,
    `${label}: ${samples.map((entry) => `${entry.name}=${entry.duration}ms`).join(", ") || "no Event Timing entry"}`,
  ).toBeLessThanOrEqual(INTERACTION_BUDGET_MS);
  return maxDuration;
}

function settingsDrawer(page: Page): Locator {
  return page.locator(".settings-drawer");
}

async function closeSettings(page: Page): Promise<void> {
  const drawer = page.locator(".settings-drawer");
  await drawer.locator(".ant-drawer-close").first().click();
  await expect(drawer.locator(".ant-drawer-content-wrapper")).toBeHidden();
}

async function openSettings(page: Page): Promise<Locator> {
  await page
    .locator(".mamep-header")
    .getByRole("button", { name: /^Settings$/ })
    .click();
  const drawer = settingsDrawer(page);
  await expect(drawer).toHaveClass(/ant-drawer-open/);
  return drawer;
}

async function readDownloadText(
  page: Page,
  trigger: () => Promise<void>,
): Promise<string> {
  const downloadPromise = page.waitForEvent("download");
  await trigger();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (stream === null) throw new Error("download stream unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

test("Settings / Connection / Add Row / 1000 行导入的 Event Timing ≤200ms", async ({
  page,
}, testInfo) => {
  await installEventTimingObserver(page);
  await openApp(page);
  expect(
    await page.evaluate(
      () =>
        PerformanceObserver.supportedEntryTypes.includes("event") &&
        Array.isArray(
          (window as unknown as { __mamepEventTiming?: unknown[] })
            .__mamepEventTiming,
        ),
    ),
    "Event Timing observer must be available and installed",
  ).toBe(true);

  const settingsStart = await interactionMark(page);
  await openSettings(page);
  await expect(page.getByText("Reset Workspace")).toBeVisible();
  const settingsWallMs =
    (await page.evaluate(() => performance.now())) - settingsStart;
  const settingsMs = await expectInteractionBudget(
    page,
    settingsStart,
    "Settings first open",
  );

  const exported = await readDownloadText(page, async () => {
    await page.getByRole("button", { name: "Export Workspace" }).click();
  });
  await closeSettings(page);

  await page
    .getByRole("button", { name: /Disconnect/ })
    .evaluate((element) => (element as HTMLElement).click());
  await expect(page.locator(".ant-layout-header")).not.toContainText(
    "Disconnect",
  );

  const connectionStart = await interactionMark(page);
  await page
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  const connectionModal = page.locator(".ant-modal-container:visible");
  await expect(connectionModal).toContainText("Connection Settings");
  const connectionWallMs =
    (await page.evaluate(() => performance.now())) - connectionStart;
  const connectionMs = await expectInteractionBudget(
    page,
    connectionStart,
    "Connection first open",
  );
  await connectionModal.getByRole("button", { name: /Cancel/ }).click();
  await expect(connectionModal).toBeHidden();

  const imported = JSON.parse(exported) as {
    sheets: Array<{
      rows: Array<Record<string, unknown>>;
    }>;
  };
  const sheet = imported.sheets[0];
  if (sheet === undefined) throw new Error("exported workspace has no sheet");
  const template = sheet.rows[0] ?? {};
  const now = Date.now();
  sheet.rows = Array.from({ length: 1_000 }, (_, index) => ({
    ...template,
    rowId: `perf-import-${String(index + 1).padStart(4, "0")}`,
    order: index + 1,
    name: `Perf Import ${String(index + 1).padStart(4, "0")}`,
    addressDraft: String(index),
    addressValue: index,
    cellText: (index % 0x10000).toString(16).padStart(4, "0").toUpperCase(),
    registerValues: [index],
    createdAt: now,
    updatedAt: now,
  }));

  const importSettings = await openSettings(page);
  const importStart = await interactionMark(page);
  const fileChooserPromise = page.waitForEvent("filechooser");
  await importSettings
    .getByRole("button", { name: "Import Workspace" })
    .click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "workspace-1000.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported), "utf8"),
  });
  const preview = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Format version" });
  await expect(preview).toBeVisible({ timeout: 10_000 });
  const importParseWallMs =
    (await page.evaluate(() => performance.now())) - importStart;
  const importParseMs = await expectInteractionBudget(
    page,
    importStart,
    "1000-row import parse/preview",
  );

  const importCommitStart = await interactionMark(page);
  await preview.getByRole("button", { name: "Import", exact: true }).click();
  await expect(preview).toBeHidden();
  await expect(page.locator(".table-toolbar__info").last()).toContainText(
    "1000",
    { timeout: 10_000 },
  );
  const importCommitWallMs =
    (await page.evaluate(() => performance.now())) - importCommitStart;
  const importCommitMs = await expectInteractionBudget(
    page,
    importCommitStart,
    "1000-row import table commit",
  );
  await closeSettings(page);

  // Add Row 在导入后的 1000 行表上验收，覆盖整表快照/重编号的最坏常见路径。
  const addRowStart = await interactionMark(page);
  await page.getByRole("button", { name: "Add Row" }).click();
  await expect(page.locator(".table-toolbar__info").last()).toContainText(
    "1001",
    { timeout: 10_000 },
  );
  const addRowWallMs =
    (await page.evaluate(() => performance.now())) - addRowStart;
  const addRowMs = await expectInteractionBudget(
    page,
    addRowStart,
    "Add Row (1000 rows)",
  );

  const metrics = {
    budgetMs: INTERACTION_BUDGET_MS,
    settingsMs,
    connectionMs,
    addRowMs,
    importParseMs,
    importCommitMs,
    wallClockMs: {
      settings: settingsWallMs,
      connection: connectionWallMs,
      addRow: addRowWallMs,
      importParse: importParseWallMs,
      importCommit: importCommitWallMs,
    },
  };
  console.log(`[interaction-event-timing] ${JSON.stringify(metrics)}`);
  await testInfo.attach("interaction-event-timing", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
});
