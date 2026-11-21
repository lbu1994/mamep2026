import type { Page } from "@playwright/test";
import { expect, test } from "../tests/fixtures";

const BASE_URL = "http://localhost:4173/";
const STORAGE_KEY = "mamep:field-performance";

async function closeStartupConnectionModal(page: Page): Promise<void> {
  const modal = page
    .locator(".ant-modal-wrap")
    .filter({ hasText: "Connection Settings" })
    .last();
  await modal
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => undefined);
  if (!(await modal.isVisible())) return;
  const cancel = modal.getByRole("button", { name: /Cancel|Close/i }).first();
  if (await cancel.isVisible()) {
    await cancel.click();
    await expect(modal).toBeHidden();
  }
}

async function openSettings(page: Page) {
  await page
    .locator(".mamep-header")
    .getByRole("button", { name: /Settings/ })
    .click();
  const drawer = page.locator(".settings-drawer.ant-drawer-open");
  await expect(drawer).toBeVisible();
  return drawer;
}

test("本地性能采样默认关闭、刷新后记录真实 Event Timing 且只导出匿名数据", async ({
  page,
}) => {
  await page.goto(BASE_URL);
  await expect(page.locator(".mamep-header")).toBeVisible({ timeout: 15_000 });
  await closeStartupConnectionModal(page);

  const firstDrawer = await openSettings(page);
  const section = firstDrawer.getByTestId("local-performance-settings");
  await expect(section).toBeVisible();
  const enabledSwitch = section.getByRole("switch", {
    name: "Collect performance data",
  });
  await expect(enabledSwitch).not.toBeChecked();
  await expect(section.getByText(/never uploads/i)).toBeVisible();

  await enabledSwitch.click();
  await expect(enabledSwitch).toBeChecked();
  await section.getByText("Warm", { exact: true }).click();
  await expect(section.locator(".ant-segmented-item-selected")).toContainText(
    "Warm",
  );
  await firstDrawer.locator(".ant-drawer-close").first().click();

  await page.reload();
  await expect(page.locator(".mamep-header")).toBeVisible({ timeout: 15_000 });
  await closeStartupConnectionModal(page);

  const secondDrawer = await openSettings(page);
  const secondSection = secondDrawer.getByTestId("local-performance-settings");
  await expect(
    secondSection.getByRole("switch", { name: "Collect performance data" }),
  ).toBeChecked();
  await expect(secondSection.getByText("Warm", { exact: true })).toBeVisible();
  await secondDrawer.locator(".ant-drawer-close").first().click();

  await expect
    .poll(
      () =>
        page.evaluate((key) => {
          const raw = localStorage.getItem(key);
          if (raw === null) return 0;
          const parsed = JSON.parse(raw) as { sessions?: unknown[] };
          return parsed.sessions?.length ?? 0;
        }, STORAGE_KEY),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);

  const stored = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  );
  expect(stored).not.toBeNull();
  expect(stored).not.toContain("cellText");
  expect(stored).not.toContain("registerValues");
  expect(stored).not.toContain("bytesHex");
  const parsedStored = JSON.parse(stored ?? "{}") as {
    enabled?: boolean;
    cacheMode?: string;
    networkProfile?: string;
    sessions?: Array<{
      cacheMode?: string;
      networkProfile?: string;
      metrics?: { interactionCount?: number; inpMs?: number | null };
    }>;
  };
  expect(parsedStored.enabled).toBe(true);
  expect(parsedStored.cacheMode).toBe("warm");
  expect(parsedStored.networkProfile).toBe("local");
  expect(parsedStored.sessions?.[0]?.cacheMode).toBe("warm");
  expect(parsedStored.sessions?.[0]?.networkProfile).toBe("local");
  expect(
    parsedStored.sessions?.[0]?.metrics?.interactionCount ?? 0,
  ).toBeGreaterThan(0);

  const drawer = await openSettings(page);
  const exportButton = drawer.getByRole("button", {
    name: "Export local report",
  });
  await expect(exportButton).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (stream === null)
    throw new Error("field performance report stream missing");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const report = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    schemaVersion?: number;
    kind?: string;
    privacy?: {
      anonymous?: boolean;
      uploaded?: boolean;
      containsWorkspaceContent?: boolean;
      containsDeviceMessages?: boolean;
    };
    sessions?: unknown[];
  };
  expect(report.schemaVersion).toBe(1);
  expect(report.kind).toBe("mamep-local-web-performance");
  expect(report.privacy).toEqual({
    anonymous: true,
    uploaded: false,
    containsWorkspaceContent: false,
    containsDeviceMessages: false,
  });
  expect(report.sessions?.length ?? 0).toBeGreaterThan(0);
});
