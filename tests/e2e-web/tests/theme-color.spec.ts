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

async function openSettings(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Settings" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".ant-modal-container:visible", { timeout: 5000 });
}

/** 禁用内置示例插件（其 theme 贡献会覆盖用户主色；插件优先级最高，ADR-042 装配链）。 */
async function disableExamplePlugin(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Plugin Manager" }).click();
  const modal = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Plugin Manager" });
  await expect(modal).toBeVisible();
  const switchEl = modal.locator(".ant-switch").first();
  await switchEl.click();
  await expect(switchEl).not.toHaveClass(/ant-switch-checked/);
  await page
    .locator(".ant-modal-container:visible .ant-modal-close")
    .first()
    .click();
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);
}

/** 打开第一个（浅色）ColorPicker 弹层并填入 HEX 色值。 */
async function setLightColor(page: Page, hex: string): Promise<void> {
  const triggers = page.locator(
    ".ant-modal-container:visible .ant-color-picker-trigger",
  );
  await triggers.first().click();
  // ColorPicker 弹层为 Popover 系 portal；输入框类 ant-color-picker-input 在弹层内唯一。
  const hexInput = page.locator(".ant-color-picker-input input");
  await expect(hexInput).toBeVisible();
  await hexInput.fill(hex);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
}

test("Settings 可设置主题色（浅色），ConfigProvider 主色与 CSS 变量同步", async ({
  page,
}) => {
  const errors = await openApp(page);
  await disableExamplePlugin(page);
  await openSettings(page);
  await setLightColor(page, "1a7f37");

  // ConfigProvider 主色已应用：--ant-color-primary 反映新色（antd cssVar 作用在
  // ConfigProvider 容器内，从应用内元素读取继承值）。
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
    .toContain("1a7f37"); // #1a7f37

  // 自定义品牌 CSS 变量同步（ADR-042 消除第二事实源）。
  await expect
    .poll(async () => {
      const value = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue(
          "--mamep-brand-primary",
        ),
      );
      return value.trim();
    })
    .toContain("1a7f37");

  // 关闭弹窗并刷新：主题色持久化（workspace.preferences.themePrimary）。
  await page
    .locator(".ant-modal-container:visible .ant-modal-close")
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  await openSettings(page);
  // 再次打开浅色 picker：HEX 输入框显示上次设置值。
  await page
    .locator(".ant-modal-container:visible .ant-color-picker-trigger")
    .first()
    .click();
  const hexInput = page.locator(".ant-color-picker-input input");
  await expect(hexInput).toBeVisible();
  await expect(hexInput).toHaveValue("1a7f37");

  expect(errors).toEqual([]);
});
