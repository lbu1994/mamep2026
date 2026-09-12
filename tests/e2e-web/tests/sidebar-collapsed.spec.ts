import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
}

async function addSheet(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "New Table", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  return errors;
}

test("collapsed sidebar pops up group submenu and switches table", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await openApp(page);

  // 准备第二张表（展开态新建）。
  await addSheet(page);
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 2");

  // 折叠侧边栏到 36px 窄条。
  await page
    .getByRole("button", { name: "Toggle sidebar" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".ant-layout-sider")).toHaveClass(
    /ant-layout-sider-collapsed/,
  );

  // 折叠窄条出现分组图标入口（Menu 收缩为 .ant-menu-inline-collapsed）。
  const collapsedMenu = page.locator(
    ".ant-layout-sider .ant-menu-inline-collapsed",
  );
  await expect(collapsedMenu).toBeVisible();

  // 悬停 holding-register 分组 -> 弹出子菜单列出该组表项。
  await collapsedMenu.locator(".ant-menu-submenu-title").first().hover();
  const popup = page.locator(".ant-menu-submenu-popup:visible");
  await expect(popup).toContainText("Sheet 1");
  await expect(popup).toContainText("Sheet 2");

  // 点击「Sheet 1」（此时活动表为新建的 Sheet 2）切换到该表（页签栏活动表跟随）。
  await popup.locator(".sheet-item", { hasText: "Sheet 1" }).first().click();
  await expect(
    page.locator(".register-table-tabs .ant-tabs-tab-active"),
  ).toContainText("Sheet 1");

  // 全程无 console 错误。
  expect(errors).toEqual([]);
});
