import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  return errors;
}

/** 表格上方工具栏里的 Slave Address 输入框（每表独立）。 */
function slaveInput(page: Page) {
  return page.locator(
    ".register-table-tabs .ant-tabs-content-active .table-toolbar__slave .ant-input-number-input",
  );
}

/** 通过侧边栏「New Table」新建一张表（侧边栏为表格管理主入口，页签栏无加号）。 */
async function addSheet(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "New Table", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(
    page.locator(".register-table-tabs .ant-tabs-tab-active"),
  ).toContainText("Sheet 2");
}

function sheetTab(page: Page, name: string) {
  return page
    .locator(".register-table-tabs div[role=tab]")
    .filter({ hasText: name });
}

test("toolbar shows a Slave Address input defaulting to 1", async ({
  page,
}) => {
  const errors = await openApp(page);
  await expect(slaveInput(page)).toHaveValue("1");
  expect(errors).toEqual([]);
});

test("Slave Address is per-table and persists across a page reload", async ({
  page,
}) => {
  await openApp(page);
  // Sheet 1：设为 7。
  await slaveInput(page).fill("7");
  await expect(slaveInput(page)).toHaveValue("7");
  // 等待 IndexedDB 自动保存落盘（防抖 500ms + 异步写入）。
  await page.waitForTimeout(1000);

  // 新建 Sheet 2：默认 1，与本表独立。
  await addSheet(page);
  await expect(slaveInput(page)).toHaveValue("1");
  // Sheet 2：设为 9。
  await slaveInput(page).fill("9");
  await expect(slaveInput(page)).toHaveValue("9");

  // 切回 Sheet 1：仍为 7（每表独立）。
  await sheetTab(page, "Sheet 1").click();
  await expect(slaveInput(page)).toHaveValue("7");

  // 刷新后恢复各自的值（每表独立）。
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  await expect(slaveInput(page)).toHaveValue("7");
  await sheetTab(page, "Sheet 2").click();
  await expect(slaveInput(page)).toHaveValue("9");
});

test("Connection Settings and Comm Properties no longer show Slave Address", async ({
  page,
}) => {
  await openApp(page);
  // Connection Settings 弹窗不再包含 Slave Address。
  await page
    .getByRole("button", { name: "Connection" })
    .evaluate((el) => (el as HTMLElement).click());
  const modal = page.locator(".ant-modal-container:visible");
  await expect(modal).toContainText("Connection Settings");
  await expect(modal).not.toContainText("Slave Address");
  await modal
    .locator(".ant-modal-close")
    .evaluate((el) => (el as HTMLElement).click());

  // Comm Properties 面板不再包含 Slave 项。
  await page
    .getByRole("tab", { name: "Comm Properties" })
    .evaluate((el) => (el as HTMLElement).click());
  const props = page.locator(".comm-props");
  await expect(props).toBeVisible();
  await expect(props).not.toContainText("Slave");
});
