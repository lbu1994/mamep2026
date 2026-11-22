import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";
// dev 门控覆盖开关（App.tsx isCompatMissMode）：强制检测输入为「无 Web Serial」。
const COMPAT_MISS_URL = "http://localhost:5173/?compatMiss=1";

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  return errors;
}

test("不支持 Web Serial：横幅 + 连接弹窗警告 + CONNECT 禁用，工作区仍可查看", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto(COMPAT_MISS_URL);
  // 应用加载、工作区可查看（表格区存在）。
  await expect(page.locator(".ant-layout-header")).toBeVisible({
    timeout: 15000,
  });
  // 启动级横幅：明确提示 + 替代方案。
  const banner = page.getByTestId("browser-compat-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Web Serial");
  await expect(banner).toContainText("Chromium");
  // 非 Mock 启动自动弹出 Connection Settings；弹窗内警告 + 替代方案 + CONNECT 禁用。
  const modal = page.locator(".ant-modal-container:visible");
  await expect(modal).toBeVisible({ timeout: 10000 });
  await expect(modal).toContainText("Web Serial is not supported");
  await expect(modal).toContainText("Chromium");
  const connect = modal.getByRole("button", { name: "CONNECT" });
  await expect(connect).toBeDisabled();
  // 工作区仍可查看/使用。
  await expect(page.locator(".register-table-tabs")).toBeVisible();
  expect(errors).toEqual([]);
});

test("正常浏览器（mock 传输）：不显示兼容性横幅", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
  await expect(page.getByTestId("browser-compat-banner")).toHaveCount(0);
  expect(errors).toEqual([]);
});
