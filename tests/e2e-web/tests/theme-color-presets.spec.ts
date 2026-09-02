/**
 * 主题色预设选择器 e2e（mockTransport=1，浏览器端，2026-09-02，ADR-047；ADR-048 去字面量）。
 * 验证：
 * - 内置仅一个选项：Ant Design 默认蓝（其值由 antd 运行时令牌决定，ADR-048：不写死色值）；
 *   --mamep-brand-primary 与页面 --ant-color-primary 同步（浅/深）；插件颜色不再自动应用；
 * - 插件（example-panel）注册的可选主题色出现在 Settings 选择器；
 * - 选中插件色 → antd token / --mamep-brand-primary 同步 + reload 持久化；
 * - 禁用插件后选项消失、已选色回退默认；
 * - 全程无 console 错误。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";
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

/** 读取 .ant-app 上的 --mamep-brand-primary（.ant-app 作用域映射 var(--ant-color-primary)，ADR-048）。 */
async function brandPrimary(page: Page): Promise<string> {
  const value = await page.evaluate(() => {
    const el = document.querySelector(".ant-app");
    return el === null
      ? ""
      : getComputedStyle(el).getPropertyValue("--mamep-brand-primary");
  });
  return value.trim();
}

/** 读取 .ant-app 上的 --ant-color-primary（antd cssVar 运行时值，本 spec 不写死具体色值）。 */
async function antdPrimary(page: Page): Promise<string> {
  const value = await page.evaluate(() => {
    const el = document.querySelector(".ant-app");
    return el === null
      ? ""
      : getComputedStyle(el).getPropertyValue("--ant-color-primary");
  });
  return value.trim();
}

/** 按当前 antd 令牌的 hex 值换算 expected computed rgb（不依赖字面量）。 */
function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (m === null) throw new Error(`invalid hex: ${hex}`);
  const raw = m[1];
  if (raw === undefined) throw new Error(`invalid hex: ${hex}`);
  const n = parseInt(raw, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
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

test("默认仅内置 Ant Design 默认蓝；插件色不自动应用（ADR-047 / ADR-048）", async ({
  page,
}) => {
  const errors = await openApp(page);

  // 默认主题色 = 运行时 antd 默认令牌；example-panel 允许但不再自动应用靛蓝。
  const antdBlue = await antdPrimary(page);
  await expect.poll(() => brandPrimary(page)).toBe(antdBlue);
  await expect.poll(() => primaryButtonColor(page)).toBe(hexToRgb(antdBlue));

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

test("默认蓝跟随 antd 令牌：--mamep-brand-primary 与 --ant-color-primary 浅/深同步（ADR-048，无字面量）", async ({
  page,
}) => {
  const errors = await openApp(page);

  // 浅色：mamep 令牌 === antd 令牌（运行时值）。
  const lightAntd = await antdPrimary(page);
  await expect.poll(() => brandPrimary(page)).toBe(lightAntd);

  // 切深色：antd 令牌更新，mamep 令牌同步跟随。
  await openSettings(page);
  await page
    .locator(".ant-modal-container:visible .ant-segmented-item-label")
    .filter({ hasText: "Dark" })
    .first()
    .click();
  await expect
    .poll(async () => {
      const value = await antdPrimary(page);
      return value;
    })
    .not.toBe(lightAntd);
  const darkAntd = await antdPrimary(page);
  await expect.poll(() => brandPrimary(page)).toBe(darkAntd);
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

  // 回退默认蓝（运行时 antd 令牌）；选择器仅剩内置默认蓝选项。
  const antdBlue = await antdPrimary(page);
  await expect.poll(() => brandPrimary(page)).toBe(antdBlue);
  await expect.poll(() => primaryButtonColor(page)).toBe(hexToRgb(antdBlue));
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
