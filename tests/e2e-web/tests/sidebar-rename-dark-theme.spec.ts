/**
 * 侧边栏重命名输入框暗色主题跟随 e2e（mockTransport=1，浏览器端，2026-09-07）。
 * Bug：暗黑模式下侧边栏 Rename 的内联输入框 `.sheet-item__input` 显示为「白底黑字」，
 * 未跟随主题（根因：该选择器未设置 background/color，输入框回退到浏览器 UA 默认样式，
 * 而 `.sheet-tab__input` 显式设置了 `--ant-color-bg-container`/`--ant-color-text`）。
 *
 * 复现（红）：
 * - 切暗色 → 侧边栏右键 Rename → `.sheet-item__input` 可见；
 * - 断言其 computed background 不为白、color 不为黑 → 修复前 UA 默认（白底黑字）使断言失败。
 * 修复（绿）：
 * - `.sheet-item__input` 补齐 `background: var(--ant-color-bg-container)` / `color: var(--ant-color-text)`，
 *   暗色下背景/文字跟随主题 → 断言通过。
 *
 * 全程无 console 错误。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  return errors;
}

function sidebarItem(page: Page, name: string) {
  return page
    .locator(".ant-layout-sider li.sheet-item")
    .filter({ hasText: new RegExp(`^${name}$`) });
}

/** 打开 Settings 弹窗并把主题切到 Dark，随后关闭弹窗。 */
async function switchToDarkTheme(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Settings" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".ant-modal-container:visible", { timeout: 5000 });
  await page
    .locator(".ant-modal-container:visible .ant-segmented-item-label")
    .filter({ hasText: "Dark" })
    .first()
    .click();
  // MamepApp 把主题同步到 <html data-mamep-theme>（index.css 暗色令牌依赖该属性）。
  await expect(page.locator("html")).toHaveAttribute(
    "data-mamep-theme",
    "dark",
  );
  await page
    .locator(".ant-modal-container:visible .ant-modal-close")
    .first()
    .click();
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);
}

test("暗黑模式侧边栏 Rename 输入框跟随主题（非白底黑字）", async ({ page }) => {
  const errors = await openApp(page);
  await switchToDarkTheme(page);

  // 侧边栏右键 Sheet 1 → Rename → 内联输入框出现。
  await sidebarItem(page, "Sheet 1").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Rename" })
    .evaluate((el) => (el as HTMLElement).click());

  const input = page.locator(".sheet-sidebar__list .sheet-item__input");
  await expect(input).toBeVisible();

  // 关键断言（修复红/绿分界）：dark 下输入框不应是浏览器 UA 默认「白底黑字」。
  const bg = await input.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  const color = await input.evaluate((el) => getComputedStyle(el).color);
  expect(bg).not.toBe("rgb(255, 255, 255)");
  expect(color).not.toBe("rgb(0, 0, 0)");

  expect(errors).toEqual([]);
});
