import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式自动连接后连接按钮就绪；窄窗口下按钮收起文字（仅状态点+图标），
  // 故不能依赖 header 含 "Disconnect" 文字，改用 data-conn-state 判定（宽/窄均适用）。
  await expect(
    page.locator(".connection-cluster__button[data-conn-state='connected']"),
  ).toBeVisible({ timeout: 15000 });
}

test("empty-address rows disable Read/Write/WP with an explanatory tooltip", async ({
  page,
}) => {
  await openApp(page);

  // mock 模式默认表已预填分类寄存器（前 N 行有地址）；新增一行保证为空地址行。
  await page
    .getByRole("button", { name: "Add Row" })
    .evaluate((el) => (el as HTMLElement).click());
  await page
    .locator(
      ".register-table-tabs .ant-tabs-content-active .ant-table-tbody-virtual-holder",
    )
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  const row = page.locator(".ant-table-tbody [data-row-key]").last();
  const readBtn = row.getByRole("button", { name: /^Read row / });
  const writeBtn = row.getByRole("button", { name: /^Write row / });
  await expect(readBtn).toBeDisabled();
  await expect(writeBtn).toBeDisabled();
  // WP 开关禁用（无合法地址）。
  await expect(row.getByLabel(/^Poll row /)).toBeDisabled();

  // 禁用控件提供说明 Tooltip（悬停 Read 所在单元格）。
  const readCell = row.locator(".ant-table-cell").filter({ hasText: "Read" });
  await readCell.hover();
  const reasonId = await readBtn.getAttribute("aria-describedby");
  expect(reasonId).toBeTruthy();
  await expect(page.locator(`[id="${reasonId}"]`)).toHaveText(
    "Set a valid register address first to enable this control.",
  );
  await expect(
    page
      .locator(".ant-tooltip")
      .filter({
        hasText: "Set a valid register address first to enable this control.",
      })
      .last(),
  ).toBeVisible();

  // 填写合法地址后控件恢复可用。
  const addressInput = row.getByLabel("Address", { exact: true });
  await addressInput.click();
  await addressInput.fill("0005");
  await addressInput.press("Enter");
  await expect(readBtn).toBeEnabled();
  await expect(writeBtn).toBeEnabled();
  await expect(row.getByLabel(/^Poll row /)).toBeEnabled();
});

test("WP polling shows a non-color polling indicator while online", async ({
  page,
}) => {
  await openApp(page);

  // 开启 WP 前：无轮询指示。
  await expect(page.locator(".register-table__wp-indicator")).toHaveCount(0);

  // 设置地址并开启 WP。
  const addressInput = page.getByLabel("Address", { exact: true }).first();
  await addressInput.click();
  await addressInput.fill("0006");
  await addressInput.press("Enter");
  await page
    .getByLabel(/^Poll row /)
    .first()
    .click();

  // 已连接 + 合法地址 + WP 开启 → 等待态图标出现，辅助文本同步表达状态。
  const wp = page.locator(".register-table__wp").first();
  await expect(wp).not.toHaveAttribute("data-polling-state", "off");
  await expect(wp.locator(".register-table__wp-indicator")).toBeVisible();
  const statusId = await wp
    .getByRole("switch")
    .getAttribute("aria-describedby");
  expect(statusId).not.toBeNull();
  await expect(page.locator(`[id="${statusId}"]`)).toHaveText(
    /^Polling (on|failed)/,
  );

  // 关闭 WP 后指示消失。
  await page
    .getByLabel(/^Poll row /)
    .first()
    .click();
  await expect(wp).toHaveAttribute("data-polling-state", "off");
  await expect(page.locator(".register-table__wp-indicator")).toHaveCount(0);
});

test("narrow viewport moves secondary header actions into a More menu", async ({
  page,
}) => {
  // 移动布局断点已统一为 1023px：1024 属桌面档，故此处改用 900。
  await page.setViewportSize({ width: 900, height: 768 });
  await openApp(page);

  // 次要操作被收纳：Settings / Help 收进 More（Plugin Manager 已并入 Settings）。
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

  // 插件管理仍可达（并入 Settings）：More → Settings → Plugins 页签。
  await menu.getByText("Settings", { exact: true }).click();
  await page.waitForSelector(".settings-drawer.ant-drawer-open", {
    timeout: 5000,
  });
  await page
    .locator(".settings-drawer")
    .getByRole("tab", { name: "Plugins" })
    .click();
  await expect(page.getByTestId("plugin-manager")).toBeVisible();

  // 连接状态始终可见：窄窗口收起文字，但保留状态点、完整可访问名称和动作属性。
  const connBtn = page.locator(".connection-cluster__button");
  await expect(connBtn).toHaveAttribute("data-conn-state", "connected");
  await expect(connBtn).toHaveAttribute("data-conn-action", "disconnect");
  await expect(connBtn).toHaveAccessibleName("Online · Disconnect");
  await expect(connBtn.locator(".conn-btn__dot")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connection settings" }),
  ).toBeVisible();
});
