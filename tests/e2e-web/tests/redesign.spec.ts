import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 显示 Online 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
}

test("empty sheet shows a guided empty state with an Add Row CTA", async ({
  page,
}) => {
  await openApp(page);
  // 默认表现在自带 defaultRowCount 行；先全选删除制造空表，再验证空态引导。
  await page
    .locator(".ant-table-thead .ant-table-selection-column .ant-checkbox-input")
    .click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".ant-empty")).toBeVisible();
  await expect(page.locator(".ant-empty")).toContainText(
    "Add rows to start reading device data.",
  );
  // 空表时页面只有唯一一个 "Add Row"（空状态 CTA），点击后出现寄存器输入。
  await page
    .getByRole("button", { name: "Add Row" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(
    page.locator('[data-register-cell="address"]').first(),
  ).toBeVisible();
});

test("bottom panel collapses to the tab bar and expands again", async ({
  page,
}) => {
  await openApp(page);
  const panel = page.locator(".bottom-panel");
  await expect(panel).toHaveCSS("height", "200px");
  await page
    .getByRole("button", { name: "Collapse panel" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".bottom-panel--collapsed")).toBeVisible();
  await expect(
    page.locator(".bottom-panel .ant-tabs-body-holder"),
  ).toBeHidden();
  // 折叠后标签栏仍可见。
  await expect(page.getByRole("tab", { name: /Messages/ })).toBeVisible();
  await page
    .getByRole("button", { name: "Expand panel" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(
    page.locator(".bottom-panel .ant-tabs-body-holder"),
  ).toBeVisible();
});
