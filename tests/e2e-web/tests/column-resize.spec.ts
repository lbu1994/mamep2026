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

function tableHeader(page: Page) {
  return page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-thead",
  );
}

/** 按表头文本定位列 th（限定在活动表格页签内，避免误匹配 BottomPanel 页签）。 */
function headerCell(page: Page, label: string) {
  return tableHeader(page).locator("th").filter({ hasText: label }).first();
}

async function columnWidth(page: Page, label: string): Promise<number> {
  return headerCell(page, label).evaluate(
    (el) => (el as HTMLElement).offsetWidth,
  );
}

/** 拖动某列表头右侧 react-resizable 手柄 deltaX 像素（向右为正）。 */
async function dragHeaderHandle(
  page: Page,
  label: string,
  deltaX: number,
): Promise<void> {
  const handle = headerCell(page, label).locator(".react-resizable-handle");
  await expect(handle).toHaveCount(1);
  const box = (await handle.boundingBox()) ?? {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 8 });
  await page.mouse.up();
}

test("resizable columns expose a resize handle; fixed-width and flexible columns do not", async ({
  page,
}) => {
  await openApp(page);
  // 可拖拽列（有默认宽且非固定宽）应有拖拽手柄：Name/Register/Data/Type。
  for (const label of ["Name", "Register", "Data", "Type"]) {
    await expect(
      headerCell(page, label).locator(".react-resizable-handle"),
    ).toHaveCount(1);
  }
  // 固定宽列（No/TM/WP/Read/Write/Drag，FIXED_WIDTH_COLUMNS）与弹性列（Comment）不提供手柄；
  // Comment 的宽度可通过拖其相邻列间接调整。
  for (const label of ["No", "TM", "WP", "Read", "Write", "Comment"]) {
    await expect(
      headerCell(page, label).locator(".react-resizable-handle"),
    ).toHaveCount(0);
  }
});

test("dragging a header handle widens the column and keeps the header text", async ({
  page,
}) => {
  const errors = await openApp(page);
  const before = await columnWidth(page, "Name");
  await dragHeaderHandle(page, "Name", 60);
  await expect
    .poll(async () => columnWidth(page, "Name"), { timeout: 3000 })
    .toBeGreaterThan(before + 30);
  // 表头文本仍在，且拖拽不产生 console 错误。
  await expect(tableHeader(page)).toContainText("Name");
  expect(errors).toEqual([]);
});

test("dragging far left clamps the column to its min width", async ({
  page,
}) => {
  const errors = await openApp(page);
  await dragHeaderHandle(page, "Name", -400);
  // 数据列 Name minWidth=80（antd 单元格 border-box，offsetWidth ≈ 80）。
  await expect
    .poll(async () => columnWidth(page, "Name"), { timeout: 3000 })
    .toBeLessThanOrEqual(85);
  expect(await columnWidth(page, "Name")).toBeGreaterThanOrEqual(75);
  expect(errors).toEqual([]);
});

test("Type column defaults to half of the previous width (72px)", async ({
  page,
}) => {
  await openApp(page);
  // 默认宽 72：antd 单元格 border-box，offsetWidth ≈ 72（与 Name 钳制测试同款容差 ±5）。
  const width = await columnWidth(page, "Type");
  expect(width).toBeGreaterThanOrEqual(67);
  expect(width).toBeLessThanOrEqual(77);
});

test("resized column widths persist across a page reload", async ({ page }) => {
  await openApp(page);
  await dragHeaderHandle(page, "Name", 60);
  const before = await columnWidth(page, "Name");
  // 拖后应明显大于默认 150。
  expect(before).toBeGreaterThan(170);
  // 等待 IndexedDB 自动保存落盘（AppHost 防抖 500ms + 异步写入），避免刷新竞态。
  await page.waitForTimeout(1000);
  await page.reload();
  // Mock 模式刷新后自动重连，就绪信号与 openApp 一致。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  // 刷新后列宽保持（workspace 恢复），不回默认宽。
  const after = await columnWidth(page, "Name");
  expect(after).toBeGreaterThanOrEqual(before - 5);
});

test("column widths are independent per tab (不共享)", async ({ page }) => {
  await openApp(page);
  // 表 1：拖宽 Name。
  await dragHeaderHandle(page, "Name", 60);
  const tab1Width = await columnWidth(page, "Name");
  expect(tab1Width).toBeGreaterThan(170);
  // 新建表 2（addSheet 自动激活）。
  await page
    .locator(".register-table-tabs .ant-tabs-nav-list .ant-tabs-nav-add")
    .click();
  await expect(
    page.locator(".register-table-tabs .ant-tabs-content-active"),
  ).toContainText("Name");
  // 表 2 的 Name 为默认宽（与表 1 不共享）。
  const tab2Width = await columnWidth(page, "Name");
  expect(tab2Width).toBeGreaterThanOrEqual(145);
  expect(tab2Width).toBeLessThanOrEqual(155);
  // 切回表 1：仍保持拖宽值。
  await page
    .locator(".register-table-tabs div[role=tab]")
    .filter({ hasText: "Sheet 1" })
    .click();
  await expect(
    page.locator(".register-table-tabs .ant-tabs-content-active"),
  ).toContainText("Name");
  const tab1Again = await columnWidth(page, "Name");
  expect(tab1Again).toBeGreaterThanOrEqual(tab1Width - 5);
});

/** 读取当前业务列顺序（过滤 selection 列等无文本 th）。 */
async function columnHeadersOrder(page: Page): Promise<string[]> {
  return tableHeader(page)
    .locator("th")
    .evaluateAll((ths) =>
      ths
        .map((th) => (th.textContent ?? "").trim())
        .filter((text) => text !== ""),
    );
}

test("resizing does not trigger column sorting (大幅调宽不拖走列)", async ({
  page,
}) => {
  const errors = await openApp(page);
  const before = await columnHeadersOrder(page);
  const beforeWidth = await columnWidth(page, "Name");
  // 大幅拖动 Name 列手柄（向右 +200px）：只应调宽，不得触发列排序把列拖走。
  await dragHeaderHandle(page, "Name", 200);
  await expect
    .poll(async () => columnWidth(page, "Name"), { timeout: 3000 })
    .toBeGreaterThan(beforeWidth + 150);
  // 列顺序保持不变（列宽拖拽与列排序完全隔离）。
  expect(await columnHeadersOrder(page)).toEqual(before);
  expect(errors).toEqual([]);
});
