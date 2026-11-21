/**
 * 侧边栏重命名输入框暗色主题跟随 e2e（mockTransport=1，浏览器端）。
 *
 * 验证：
 * - 切暗色 → 侧边栏右键 Rename → `.sheet-item__input` 可见；
 * - `.sheet-item__input` 的 `background: var(--ant-color-bg-container)` /
 *   `color: var(--ant-color-text)` 随主题切换，暗色下不出现浏览器默认白底黑字。
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

/** 打开 Settings 抽屉并把主题切到 Dark，随后关闭抽屉（容器为 Drawer）。 */
async function switchToDarkTheme(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".settings-drawer.ant-drawer-open", {
    timeout: 5000,
  });
  await page
    .locator(".settings-drawer .ant-segmented-item-label")
    .filter({ hasText: "Dark" })
    .first()
    .click();
  // MamepApp 把主题同步到 <html data-mamep-theme>（index.css 暗色令牌依赖该属性）。
  await expect(page.locator("html")).toHaveAttribute(
    "data-mamep-theme",
    "dark",
  );
  await page.locator(".settings-drawer .ant-drawer-close").first().click();
  // 等离场动画结束，避免后续侧边栏交互落在仍在收起的抽屉/遮罩上。
  await expect(
    page.locator(".settings-drawer .ant-drawer-content-wrapper"),
  ).toBeHidden();
  await expect(page.locator(".settings-drawer.ant-drawer-open")).toHaveCount(0);
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

  // Dark 下输入框不应是浏览器默认「白底黑字」。
  const bg = await input.evaluate((el) => getComputedStyle(el).backgroundColor);
  const color = await input.evaluate((el) => getComputedStyle(el).color);
  expect(bg).not.toBe("rgb(255, 255, 255)");
  expect(color).not.toBe("rgb(0, 0, 0)");

  expect(errors).toEqual([]);
});
