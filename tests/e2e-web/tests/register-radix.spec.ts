import { expect, test, type Locator, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
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
}

/** 表格上方工具栏里的 DEC/HEX 切换控件（ADR-014；Address Adjust 也是 Segmented，需收窄到 __radix 容器）。 */
function radixGroup(page: Page) {
  return page.locator(".table-toolbar__radix .ant-segmented");
}

function clickRadix(page: Page, label: "DEC" | "HEX"): Promise<void> {
  return radixGroup(page)
    .locator(".ant-segmented-item")
    .filter({ hasText: label })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

function tableHeader(page: Page) {
  return page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-thead",
  );
}

function registerInput(page: Page) {
  return page.getByLabel("Register", { exact: true }).first();
}

/** 进入可编辑单元格编辑态并填充（非编辑态是 div[role=button]，需先点击，2026-08-15 编辑模式设计）。 */
async function clickAndFill(locator: Locator, value: string): Promise<void> {
  await locator.click();
  await locator.fill(value);
}

async function addFirstRow(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Add Row" })
    .evaluate((el) => (el as HTMLElement).click());
}

test("Register address defaults to DEC and the header reflects it", async ({
  page,
}) => {
  await openApp(page);
  await expect(tableHeader(page)).toContainText("Register[DEC]");
  await expect(tableHeader(page)).not.toContainText("Register[HEX]");
  // 工具栏切换控件存在，且 DEC 为当前选中项。
  await expect(radixGroup(page)).toContainText("DEC");
  await expect(radixGroup(page)).toContainText("HEX");
  await expect(
    radixGroup(page).locator(".ant-segmented-item-selected"),
  ).toContainText("DEC");
  // 标签说明该控件作用于 Register 地址列（ADR-014 工具栏提示）。
  await expect(page.locator(".table-toolbar__radix-label")).toContainText(
    "Register:",
  );
});

test("switching to HEX updates the header and pads committed addresses", async ({
  page,
}) => {
  await openApp(page);
  await clickRadix(page, "HEX");
  await expect(tableHeader(page)).toContainText("Register[HEX]");
  await expect(tableHeader(page)).not.toContainText("Register[DEC]");

  await addFirstRow(page);
  const input = registerInput(page);
  await clickAndFill(input, "1f");
  await input.press("Enter");
  await expect(input).toHaveText("001F");
});

test("HEX mode rejects the 0x prefix and keeps the draft", async ({ page }) => {
  await openApp(page);
  await clickRadix(page, "HEX");
  await addFirstRow(page);
  const input = registerInput(page);
  await clickAndFill(input, "0x12");
  await input.press("Enter");
  await expect(input).toHaveText("0x12");
  await expect(input).toHaveClass(
    /register-table__editable-cell-value-wrap--error/,
  );
});

test("DEC mode rejects hex letters and out-of-range values", async ({
  page,
}) => {
  await openApp(page);
  await addFirstRow(page);
  const input = registerInput(page);
  await clickAndFill(input, "1F");
  await input.press("Enter");
  await expect(input).toHaveText("1F");
  await expect(input).toHaveClass(
    /register-table__editable-cell-value-wrap--error/,
  );

  await clickAndFill(input, "70000");
  await input.press("Enter");
  await expect(input).toHaveText("70000");
  await expect(input).toHaveClass(
    /register-table__editable-cell-value-wrap--error/,
  );

  // 合法十进制提交成功，无错误态。
  await clickAndFill(input, "31");
  await input.press("Enter");
  await expect(input).toHaveText("31");
  await expect(input).not.toHaveClass(
    /register-table__editable-cell-value-wrap--error/,
  );
});

test("switching mode does not reformat already committed addresses", async ({
  page,
}) => {
  await openApp(page);
  await clickRadix(page, "HEX");
  await addFirstRow(page);
  const input = registerInput(page);
  await clickAndFill(input, "1f");
  await input.press("Enter");
  await expect(input).toHaveText("001F");

  // 切回 DEC：已提交文本保持 "001F"，不做重排（仅影响后续解析与表头）。
  await clickRadix(page, "DEC");
  await expect(tableHeader(page)).toContainText("Register[DEC]");
  await expect(input).toHaveText("001F");
});

test("radix is per-sheet and survives a reload", async ({ page }) => {
  await openApp(page);

  // Sheet 1 设为 HEX。
  await clickRadix(page, "HEX");
  await expect(tableHeader(page)).toContainText("Register[HEX]");

  // 新建 Sheet 2：默认仍为 DEC，不受 Sheet 1 影响。
  await page
    .getByRole("button", { name: "New Register Table", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 2");
  await expect(tableHeader(page)).toContainText("Register[DEC]");
  await expect(tableHeader(page)).not.toContainText("Register[HEX]");

  // 切回 Sheet 1：保持 HEX。
  await page
    .locator(".ant-layout-sider li")
    .filter({ hasText: "Sheet 1" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(tableHeader(page)).toContainText("Register[HEX]");

  // 等待自动保存后刷新，验证每表进制独立持久化。
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  // 刷新后活动表为 Sheet 1，仍为 HEX。
  await expect(tableHeader(page)).toContainText("Register[HEX]");
  // Sheet 2 仍为 DEC。
  await page
    .locator(".ant-layout-sider li")
    .filter({ hasText: "Sheet 2" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(tableHeader(page)).toContainText("Register[DEC]");
  await expect(tableHeader(page)).not.toContainText("Register[HEX]");
});
