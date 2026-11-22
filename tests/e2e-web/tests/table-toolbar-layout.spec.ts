import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const BASE_URL = "http://localhost:5173/?mockTransport=1";
const DESKTOP_WIDTHS = [1024, 1280, 1366, 1440];

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(
    page.locator(".connection-cluster__button[data-conn-state='connected']"),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-startup-hydrated="true"]')).toHaveCount(1);
}

for (const width of DESKTOP_WIDTHS) {
  test(`${width}px 首层工具栏不横向溢出且只保留常用操作`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openApp(page);

    const toolbar = page.locator(".table-toolbar").first();
    for (const name of [
      "Undo",
      "Redo",
      "Add Row",
      "Read All",
      "Table settings",
    ]) {
      await expect(toolbar.getByRole("button", { name })).toBeVisible();
    }
    await expect(
      toolbar.locator(
        ".table-toolbar__radix, .table-toolbar__slave, .table-toolbar__verify, .table-toolbar__adjust, .table-toolbar__plugins",
      ),
    ).toHaveCount(0);

    const toolbarSize = await toolbar.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(toolbarSize.scrollWidth).toBeLessThanOrEqual(
      toolbarSize.clientWidth + 1,
    );

    const summary = page.locator(
      ".register-table-tabs .ant-tabs-content-active .register-table__summary",
    );
    await expect(summary).toContainText("rows");
    const summaryBox = await summary.boundingBox();
    const headerBox = await page
      .locator(".register-table-tabs .ant-tabs-content-active .ant-table-thead")
      .first()
      .boundingBox();
    expect(summaryBox).not.toBeNull();
    expect(headerBox).not.toBeNull();
    expect(summaryBox!.y + summaryBox!.height).toBeLessThanOrEqual(
      headerBox!.y + 1,
    );
  });
}

test("Table settings 可键盘打开、遍历、关闭并恢复焦点", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await openApp(page);

  const trigger = page
    .getByRole("button", { name: "Table settings", exact: true })
    .first();
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Table settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(dialog.getByText("Address", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Writing", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Columns", { exact: true })).toBeVisible();
  expect(
    await dialog
      .locator(".table-toolbar__settings-section-title")
      .allTextContents(),
  ).toEqual(["Address", "Writing", "Columns"]);

  // 面板获得初始焦点后，Shift+Tab 回绕到最后一个可聚焦控件，Tab 再回到关闭按钮。
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByLabel("Write verification")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close table settings" }),
  ).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
});
