/**
 * 插件贡献点机制 e2e（mockTransport=1，浏览器端，2026-08-31，ADR-039 Phase A）。
 * 内置示例插件（example-panel）声明 panels 贡献点（2026-09-03：theme 已剥离到
 * `plugins/example-theme`，不随包、需手动安装），验证：
 * - panels 贡献：底部面板出现「插件」页签，展示示例插件标题与占位内容；
 * - 禁用插件后：插件页签消失、主色仍为默认蓝（无插件自动应用层）；
 * - 全程无 console 错误。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

/** 读取 .ant-app 上的 --ant-color-primary（antd cssVar 运行时值）。 */
async function antdPrimary(page: Page): Promise<string> {
  const value = await page.evaluate(() => {
    const el = document.querySelector(".ant-app");
    return el === null
      ? ""
      : getComputedStyle(el).getPropertyValue("--ant-color-primary");
  });
  return value.trim();
}

/** 按当前 antd 令牌 hex 换算 expected computed rgb（不依赖字面量）。 */
function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (m === null) throw new Error(`invalid hex: ${hex}`);
  const raw = m[1];
  if (raw === undefined) throw new Error(`invalid hex: ${hex}`);
  const n = parseInt(raw, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

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

test("内置插件贡献：底部面板插件页签；无随包主题色自动应用", async ({ page }) => {
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

  // 3. example-panel 已无 theme 贡献（剥离到 example-theme，未安装）：
  //    主色为默认蓝（antd 运行时令牌，无插件自动应用层）。
  await expect
    .poll(() => primaryButtonColor(page), { timeout: 5000 })
    .toBe(hexToRgb(await antdPrimary(page)));
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

  // theme 无自动应用层（ADR-047）：禁用后主色仍为默认蓝（antd 运行时令牌）。
  await expect
    .poll(() => primaryButtonColor(page), { timeout: 5000 })
    .toBe(hexToRgb(await antdPrimary(page)));
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
