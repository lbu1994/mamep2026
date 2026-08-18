import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
}

test("empty-address rows disable Read/Write/WP with an explanatory tooltip", async ({
  page,
}) => {
  await openApp(page);

  // 全新上下文：默认表 50 行均为空地址，第一行即可验证。
  const row = page.locator(".ant-table-tbody tr[data-row-key]").first();
  const readBtn = row.getByRole("button", { name: "Read", exact: true });
  const writeBtn = row.getByRole("button", { name: "Write", exact: true });
  await expect(readBtn).toBeDisabled();
  await expect(writeBtn).toBeDisabled();
  // WP 开关禁用（无合法地址）。
  await expect(row.getByLabel("WP")).toBeDisabled();

  // 禁用控件提供说明 Tooltip（悬停 Read 所在单元格）。
  const readCell = row.locator("td").filter({ hasText: "Read" });
  await readCell.hover();
  await expect(
    page.getByText(
      "Set a valid register address first to enable this control.",
    ),
  ).toBeVisible();

  // 填写合法地址后控件恢复可用。
  const addressInput = page.getByLabel("Register", { exact: true }).first();
  await addressInput.click();
  await addressInput.fill("0005");
  await addressInput.press("Enter");
  await expect(readBtn).toBeEnabled();
  await expect(writeBtn).toBeEnabled();
  await expect(row.getByLabel("WP")).toBeEnabled();
});

test("WP polling shows a non-color polling indicator while online", async ({
  page,
}) => {
  await openApp(page);

  // 开启 WP 前：无轮询指示。
  await expect(page.getByLabel("Polling at Rx Delay interval")).toHaveCount(0);

  // 设置地址并开启 WP。
  const addressInput = page.getByLabel("Register", { exact: true }).first();
  await addressInput.click();
  await addressInput.fill("0006");
  await addressInput.press("Enter");
  await page.getByLabel("WP").first().click();

  // 已连接 + 合法地址 + WP 开启 → 轮询指示出现（非颜色表达，配 aria-label/Tooltip）。
  const indicator = page.getByLabel("Polling at Rx Delay interval");
  await expect(indicator).toBeVisible();

  // 关闭 WP 后指示消失。
  await page.getByLabel("WP").first().click();
  await expect(page.getByLabel("Polling at Rx Delay interval")).toHaveCount(0);
});

test("narrow viewport moves secondary header actions into a More menu", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openApp(page);

  // 次要操作被收纳：Plugin Manager 按钮不再直接渲染，出现 More 按钮。
  await expect(
    page.getByRole("button", { name: "Plugin Manager" }),
  ).toHaveCount(0);
  const moreBtn = page.getByRole("button", { name: "More", exact: true });
  await expect(moreBtn).toBeVisible();

  // More 菜单包含 Settings / Help（主题仅能在 Settings 中修改，顶栏无直达入口）。
  await moreBtn.click();
  const menu = page.locator(".ant-dropdown-menu:visible");
  await expect(menu.getByText("Settings", { exact: true })).toBeVisible();
  await expect(menu.getByText("Help", { exact: true })).toBeVisible();
  await expect(menu.getByText("Theme", { exact: true })).toHaveCount(0);

  // 连接状态始终可见。
  await expect(page.locator(".status-badge")).toContainText("Online");
});
