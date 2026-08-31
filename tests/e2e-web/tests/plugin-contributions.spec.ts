/**
 * 插件贡献点机制 e2e（mockTransport=1，浏览器端，2026-08-31，ADR-039 Phase A）。
 * 内置示例插件（example-panel）声明 panels + theme 两个贡献点，验证：
 * - panels 贡献：底部面板出现「插件」页签，展示示例插件标题与占位内容；
 * - theme 贡献：装配链生效——主色按钮背景为插件贡献的 #4f46e5（浅色）；
 * - 禁用插件后：插件页签消失、主色回退默认（#1460d6）；
 * - 全程无 console 错误。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
}

/** 主色按钮的 computed background-color（Read All 为 antd primary）。 */
async function primaryButtonColor(page: Page): Promise<string> {
  const color = await page
    .locator(".table-toolbar .ant-btn-primary")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  return color;
}

test("内置插件贡献：底部面板插件页签 + 主题主色生效", async ({ page }) => {
  await openApp(page);

  // 1. panels 贡献：底部面板出现「插件」页签。
  const pluginsTab = page
    .locator(".ant-tabs-tab")
    .filter({ hasText: "Plugins" });
  await expect(pluginsTab).toBeVisible();

  // 2. 切换到插件页签：展示示例插件面板（标题 + 占位）。
  await pluginsTab.click();
  await expect(page.locator(".plugin-panels")).toBeVisible();
  await expect(page.locator(".plugin-panel")).toContainText("Example Plugin");
  await expect(page.locator(".plugin-panel")).toContainText(
    "Plugin panel content will be provided by the plugin runtime.",
  );

  // 3. theme 贡献：主色按钮为插件贡献色（#4f46e5）。
  await expect
    .poll(() => primaryButtonColor(page), { timeout: 5000 })
    .toBe("rgb(79, 70, 229)");
});

test("禁用插件：插件页签消失、主色回退默认", async ({ page }) => {
  await openApp(page);

  // 打开 Plugin Manager，关闭 example-panel 的启用开关。
  await page.getByRole("button", { name: "Plugin Manager" }).click();
  const modal = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Plugin Manager" });
  await expect(modal).toBeVisible();
  const switchEl = modal.locator(".ant-switch").first();
  await switchEl.click();
  await expect(switchEl).not.toHaveClass(/ant-switch-checked/);
  // 关闭弹窗。
  await modal.getByRole("button", { name: "Close" }).click().catch(() => {
    // antd v6 Modal 关闭按钮 aria 可能不同，回退点击右上角关闭。
    return page.locator(".ant-modal-container .ant-modal-close").first().click();
  });
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);

  // panels 贡献消失：底部面板无「插件」页签。
  await expect(
    page.locator(".ant-tabs-tab").filter({ hasText: "Plugins" }),
  ).toHaveCount(0);

  // theme 贡献消失：主色回退默认（#1460d6）。
  await expect
    .poll(() => primaryButtonColor(page), { timeout: 5000 })
    .toBe("rgb(20, 96, 214)");
});

test("无 console 错误（含 antd 弃用）", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  await openApp(page);
  await page.getByRole("button", { name: "Plugin Manager" }).click();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
