import { expect, test, type Page } from "@playwright/test";
import { installExecutablePlugin } from "./helpers/manual-plugins";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 显示 Online 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
  //地址变换由插件提供（不再随包安装）——先手动安装，
  // 并在确认框中授权「同进程执行」（隔离线程无法提供同步变换）。
  await installExecutablePlugin(page, {
    pluginId: "builtin-address-adjust",
    pluginName: "Address Adjust",
    executionMode: "same-process",
  });
  return errors;
}

/** 打开 Table settings 并返回其中的 Address Adjust Segmented（每表独立）。 */
async function adjustSegmented(page: Page) {
  const activeTable = page.locator(
    ".register-table-tabs .ant-tabs-content-active",
  );
  const trigger = activeTable.getByRole("button", {
    name: "Table settings",
    exact: true,
  });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect
    .poll(() => page.locator(".table-toolbar__settings:visible").count())
    .toBe(1);
  const panel = page.locator(".table-toolbar__settings:visible");
  await expect(panel).toBeVisible();
  return panel.locator(".table-toolbar__adjust");
}

test("toolbar shows Address Adjust defaulting to OFF（Connection Settings 已移除全局项）", async ({
  page,
}) => {
  const errors = await openApp(page);
  const container = await adjustSegmented(page);
  await expect(container).toContainText("Address Adjust");
  // 默认选中 OFF（antd Segmented 恒渲染 OFF/ON 两项，用 selected 类断言选中态）。
  await expect(container.locator(".ant-segmented-item-selected")).toHaveText(
    "OFF",
  );

  // Connection Settings 弹窗不再包含 Address Adjust（全局选项已移出核心）。
  await page
    .getByRole("button", { name: "Connection settings" })
    .evaluate((el) => (el as HTMLElement).click());
  const modal = page.locator(".ant-modal-container:visible");
  await expect(modal).toContainText("Connection Settings");
  await expect(modal).not.toContainText("Address Adjust");
  await modal
    .locator(".ant-modal-close")
    .evaluate((el) => (el as HTMLElement).click());

  expect(errors).toEqual([]);
});

test("Address Adjust ON：用户地址 1 发送到 0（comm log 帧地址 00 00）", async ({
  page,
}) => {
  const errors = await openApp(page);
  // 给首行填地址 1（dec 默认）。
  const addressInput = page.locator('[data-register-cell="address"]').first();
  await addressInput.click();
  await addressInput.fill("1");
  await addressInput.press("Enter");

  // 工具栏切到 ON。
  const container = await adjustSegmented(page);
  await container
    .locator(".ant-segmented-item", { hasText: "ON" })
    .evaluate((el) => (el as HTMLElement).click());

  // 读取首行：ON 时发送地址 = 用户地址 − 1 = 0。
  await page
    .getByRole("button", { name: /^Read row / })
    .first()
    .evaluate((el) => (el as HTMLElement).click());

  // Comm Log 显示请求帧：slave 01, FC03, 地址 00 00（而非 00 01）。
  await page
    .getByRole("tab", { name: "Comm Log" })
    .evaluate((el) => (el as HTMLElement).click());
  const list = page.locator(".comm-log__list");
  await expect(list).toContainText("01 03 00 00 00 01", { timeout: 5000 });
  expect(errors).toEqual([]);
});

test("Address Adjust 每表独立且刷新后恢复", async ({ page }) => {
  await openApp(page);
  const container = await adjustSegmented(page);
  // Sheet 1：切到 ON。
  await container
    .locator(".ant-segmented-item", { hasText: "ON" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(container.locator(".ant-segmented-item-selected")).toHaveText(
    "ON",
  );
  await page.waitForTimeout(1000); // 等待 IndexedDB 自动保存落盘（防抖）。

  // 新建 Sheet 2：默认 OFF（每表独立）。
  await page
    .getByRole("button", { name: "New Table", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(
    page.locator(".register-table-tabs .ant-tabs-tab-active"),
  ).toContainText("Sheet 2");
  const container2 = await adjustSegmented(page);
  await expect(container2.locator(".ant-segmented-item-selected")).toHaveText(
    "OFF",
  );

  // 切回 HOLDING REGISTERS Sheet 1：仍为 ON。
  await page.getByRole("tab", { name: "HOLDING REGISTERS Sheet 1" }).click();
  await expect(
    (await adjustSegmented(page)).locator(".ant-segmented-item-selected"),
  ).toHaveText("ON");

  // 刷新后恢复：Sheet 1 ON、Sheet 2 OFF。
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
  await expect(
    (await adjustSegmented(page)).locator(".ant-segmented-item-selected"),
  ).toHaveText("ON");
  await page.getByRole("tab", { name: "HOLDING REGISTERS Sheet 2" }).click();
  await expect(
    (await adjustSegmented(page)).locator(".ant-segmented-item-selected"),
  ).toHaveText("OFF");
});
