/**
 * 主题色预设选择器 e2e（mockTransport=1，浏览器端，2026-09-02，ADR-047）。
 * 验证：
 * - 内置仅一个选项：Ant Design 默认蓝（#1677ff 浅 / #1668dc 暗）；插件颜色不再自动应用；
 * - 插件（example-panel）注册的可选主题色出现在 Settings 选择器；
 * - 选中插件色 → antd token / --mamep-brand-primary 同步 + reload 持久化；
 * - 禁用插件后选项消失、已选色回退默认；
 * - 全程无 console 错误。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";
const DEFAULT_BLUE = "#1677ff";
const INDIGO = "#4f46e5";

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

async function openSettings(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Settings" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".ant-modal-container:visible", { timeout: 5000 });
}

async function closeModal(page: Page): Promise<void> {
  await page
    .locator(".ant-modal-container:visible .ant-modal-close")
    .first()
    .click();
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);
}

/** 读取 document root 的 --mamep-brand-primary（主题装配 effect 注入）。 */
async function brandPrimary(page: Page): Promise<string> {
  const value = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue(
      "--mamep-brand-primary",
    ),
  );
  return value.trim();
}

/** 主色按钮的 computed background-color（Read All 为 antd primary）。 */
async function primaryButtonColor(page: Page): Promise<string> {
  const color = await page
    .locator(".table-toolbar .ant-btn-primary")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  return color;
}

/** 主题色 Select（aria-label = "Accent color"）。 */
function themeColorSelect(page: Page) {
  return page.getByLabel("Accent color");
}

/** 在主题色下拉中按名称选择选项。 */
async function selectThemeColor(page: Page, name: string): Promise<void> {
  await themeColorSelect(page).click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: name })
    .first()
    .click();
}

test("默认仅内置 Ant Design 默认蓝；插件色不自动应用（ADR-047）", async ({
  page,
}) => {
  const errors = await openApp(page);

  // 默认主题色 = antd 默认蓝（#1677ff）；example-panel 允许但不再自动应用靛蓝。
  await expect.poll(() => brandPrimary(page)).toBe(DEFAULT_BLUE);
  await expect.poll(() => primaryButtonColor(page)).toBe("rgb(22, 119, 255)");

  // Settings 选择器：内置默认蓝 + 插件注册色均出现。
  await openSettings(page);
  await themeColorSelect(page).click();
  const options = page
    .locator(".ant-select-dropdown:visible .ant-select-item-option");
  await expect(options.filter({ hasText: "Default blue" })).toHaveCount(1);
  await expect(options.filter({ hasText: "Indigo" })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await closeModal(page);

  expect(errors).toEqual([]);
});

test("选中插件色：antd token 与 CSS 变量同步 + reload 持久化", async ({
  page,
}) => {
  const errors = await openApp(page);
  await openSettings(page);
  await selectThemeColor(page, "Indigo");

  // token / CSS 变量同步到插件色（#4f46e5）。
  await expect
    .poll(async () => {
      const value = await page.evaluate(() => {
        const el = document.querySelector(".ant-layout-header");
        return el === null
          ? ""
          : getComputedStyle(el).getPropertyValue("--ant-color-primary");
      });
      return value.trim();
    })
    .toContain(INDIGO);
  await expect.poll(() => brandPrimary(page)).toBe(INDIGO);
  await expect.poll(() => primaryButtonColor(page)).toBe("rgb(79, 70, 229)");

  // 持久化：关闭弹窗 → 刷新 → 仍是靛蓝。
  await closeModal(page);
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  await openSettings(page);
  await themeColorSelect(page).click();
  const options = page
    .locator(".ant-select-dropdown:visible .ant-select-item-option");
  await expect(options.filter({ hasText: "Indigo" })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await closeModal(page);
  await expect.poll(() => brandPrimary(page)).toBe(INDIGO);

  expect(errors).toEqual([]);
});

test("禁用插件后选项消失、已选色回退默认（ADR-047）", async ({ page }) => {
  const errors = await openApp(page);
  await openSettings(page);
  await selectThemeColor(page, "Indigo");
  await closeModal(page);

  // 禁用 example-panel。
  await page.getByRole("button", { name: "Plugin Manager" }).click();
  const modal = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Plugin Manager" });
  await expect(modal).toBeVisible();
  const switchEl = modal.locator(".ant-switch").first();
  await switchEl.click();
  await expect(switchEl).not.toHaveClass(/ant-switch-checked/);
  await modal.getByRole("button", { name: "Close" }).click().catch(() => {
    return page.locator(".ant-modal-container .ant-modal-close").first().click();
  });
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);

  // 回退默认蓝；选择器仅剩内置默认蓝选项。
  await expect.poll(() => brandPrimary(page)).toBe(DEFAULT_BLUE);
  await expect.poll(() => primaryButtonColor(page)).toBe("rgb(22, 119, 255)");
  await openSettings(page);
  await themeColorSelect(page).click();
  const options = page
    .locator(".ant-select-dropdown:visible .ant-select-item-option");
  await expect(options.filter({ hasText: "Default blue" })).toHaveCount(1);
  await expect(options.filter({ hasText: "Indigo" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await closeModal(page);

  expect(errors).toEqual([]);
});
