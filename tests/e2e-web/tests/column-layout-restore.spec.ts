import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

/** 默认业务列顺序（selection 列是 antd 内置第一列、无文本，不参与）。 */
const DEFAULT_ORDER = [
  "No",
  "TM",
  "Name",
  "Register[DEC]",
  "WP",
  "Read",
  "Data",
  "Write",
  "Type",
  "Comment",
];

/** 表头文本 → 列 key（供 body 行同步断言映射）。 */
const HEADER_TO_KEY: Record<string, string> = {
  No: "no",
  TM: "tm",
  Name: "name",
  "Register[DEC]": "address",
  WP: "wp",
  Read: "read",
  Data: "data",
  Write: "write",
  Type: "type",
  Comment: "comment",
};

/** body 首行各列 cell 的定位标识（与 firstRowCellLabels 提取规则一致：优先 [aria-label]，否则文本）。 */
const BODY_LABEL_BY_COLUMN: Record<string, string> = {
  no: "1",
  tm: "TM",
  name: "Name",
  address: "Register",
  wp: "WP",
  read: "Read",
  data: "Data",
  write: "Write",
  type: "Type",
  comment: "Comment",
  drag: "Drag to reorder",
};

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

/** 恢复列布局按钮（工具栏右侧组，文案走 i18n en-US "Reset layout"；默认语言 en-US）。 */
function restoreButton(page: Page) {
  return page.getByRole("button", { name: "Reset layout" });
}

async function columnHeaders(page: Page): Promise<string[]> {
  return tableHeader(page)
    .locator("th")
    .evaluateAll((ths) =>
      ths
        .map((th) => (th.textContent ?? "").trim())
        .filter((text) => text !== ""),
    );
}

async function columnWidth(page: Page, label: string): Promise<number> {
  return headerCell(page, label).evaluate(
    (el) => (el as HTMLElement).offsetWidth,
  );
}

/** 把 from 列表头拖到 to 列表头中心（dnd-kit PointerSensor distance:1）。 */
async function dragColumnTo(
  page: Page,
  fromLabel: string,
  toLabel: string,
): Promise<void> {
  const from = headerCell(page, fromLabel);
  const to = headerCell(page, toLabel);
  const fromBox = (await from.boundingBox()) ?? {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  const toBox = (await to.boundingBox()) ?? {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  const startX = fromBox.x + fromBox.width / 2;
  const startY = fromBox.y + fromBox.height / 2;
  const endX = toBox.x + toBox.width / 2;
  const endY = toBox.y + toBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
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

/**
 * 读取 body 第一行各 td 的顺序标识：优先取单元格内 [aria-label]，否则取文本。
 * 必须限定 tr.ant-table-row（真实数据行），antd 的 rowSelection 表头行也在 .ant-table-tbody 内。
 */
async function firstRowCellLabels(page: Page): Promise<string[]> {
  return page
    .locator(
      ".register-table-tabs .ant-tabs-content-active .ant-table-tbody tr.ant-table-row",
    )
    .first()
    .locator("td")
    .evaluateAll((tds) =>
      tds.map((td) => {
        const labeled = td.querySelector("[aria-label]");
        const label = labeled?.getAttribute("aria-label") ?? "";
        const text = (td.textContent ?? "").trim();
        return label || text;
      }),
    );
}

test("restore button is disabled by default and enabled after layout customization", async ({
  page,
}) => {
  const errors = await openApp(page);
  // 默认无自定义布局：按钮禁用。
  await expect(restoreButton(page)).toBeDisabled();
  // 拖排序 + 拖宽后按钮可用。
  await dragColumnTo(page, "Name", "No");
  await dragHeaderHandle(page, "Name", 60);
  await expect(restoreButton(page)).toBeEnabled();
  expect(errors).toEqual([]);
});

test("clicking restore resets column order and widths for the current sheet", async ({
  page,
}) => {
  const errors = await openApp(page);
  // 自定义布局：Name 拖到最前 + Name 加宽 60px。
  await dragColumnTo(page, "Name", "No");
  await expect
    .poll(async () => columnHeaders(page), { timeout: 3000 })
    .toEqual([
      "Name",
      "No",
      "TM",
      "Register[DEC]",
      "WP",
      "Read",
      "Data",
      "Write",
      "Type",
      "Comment",
    ]);
  await dragHeaderHandle(page, "Name", 60);
  await expect
    .poll(async () => columnWidth(page, "Name"), { timeout: 3000 })
    .toBeGreaterThan(170);
  // 一键恢复：列序回到默认、列宽回到默认（Name 150）、按钮回到禁用。
  await restoreButton(page).click();
  await expect
    .poll(async () => columnHeaders(page), { timeout: 3000 })
    .toEqual(DEFAULT_ORDER);
  const width = await columnWidth(page, "Name");
  expect(width).toBeGreaterThanOrEqual(145);
  expect(width).toBeLessThanOrEqual(155);
  await expect(restoreButton(page)).toBeDisabled();
  // body 数据列与表头同步（恢复后首行列序与 DEFAULT_ORDER 一致）。
  // 注意：首列为 rowSelection 复选框（aria-label="Select row 1"），最右为 drag 列手柄（label="Drag to reorder"）。
  const labels = await firstRowCellLabels(page);
  expect(labels).toEqual([
    "Select row 1",
    ...DEFAULT_ORDER.map((header) => {
      const key = HEADER_TO_KEY[header];
      return key === undefined ? "" : (BODY_LABEL_BY_COLUMN[key] ?? "");
    }),
    "Drag to reorder",
  ]);
  expect(errors).toEqual([]);
});

test("restore persists across a page reload", async ({ page }) => {
  await openApp(page);
  // 自定义布局（拖排序 + 拖宽），等待 IndexedDB 自动保存落盘（防抖 500ms + 异步写入）。
  await dragColumnTo(page, "Name", "No");
  await dragHeaderHandle(page, "Name", 60);
  await page.waitForTimeout(1000);
  // 一键恢复，再等待自动保存落盘后刷新。
  await restoreButton(page).click();
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  // 刷新后保持默认布局（恢复结果已持久化，不回自定义），按钮保持禁用。
  expect(await columnHeaders(page)).toEqual(DEFAULT_ORDER);
  const width = await columnWidth(page, "Name");
  expect(width).toBeGreaterThanOrEqual(145);
  expect(width).toBeLessThanOrEqual(155);
  await expect(restoreButton(page)).toBeDisabled();
});

test("restore only affects the current sheet (不共享)", async ({ page }) => {
  await openApp(page);
  // 表 1：自定义布局（Name 前移 + 加宽）。
  await dragColumnTo(page, "Name", "No");
  await dragHeaderHandle(page, "Name", 60);
  // 新建表 2（addSheet 自动激活）并自定义另一种布局（Data 移到 Write 后 + Type 加宽）。
  await page
    .locator(".register-table-tabs .ant-tabs-nav-list .ant-tabs-nav-add")
    .click();
  await expect(
    page.locator(".register-table-tabs .ant-tabs-content-active"),
  ).toContainText("Name");
  await dragColumnTo(page, "Data", "Write");
  await dragHeaderHandle(page, "Type", 40);
  // 切回表 1 并一键恢复。
  await page
    .locator(".register-table-tabs div[role=tab]")
    .filter({ hasText: "Sheet 1" })
    .click();
  await expect(
    page.locator(".register-table-tabs .ant-tabs-content-active"),
  ).toContainText("Name");
  await restoreButton(page).click();
  // 表 1 恢复默认。
  expect(await columnHeaders(page)).toEqual(DEFAULT_ORDER);
  const nameWidth = await columnWidth(page, "Name");
  expect(nameWidth).toBeGreaterThanOrEqual(145);
  expect(nameWidth).toBeLessThanOrEqual(155);
  // 表 2 不受影响：Data 仍在 Write 之后（自定义列序保留）、Type 仍为加宽值。
  await page
    .locator(".register-table-tabs div[role=tab]")
    .filter({ hasText: "Sheet 2" })
    .click();
  await expect(
    page.locator(".register-table-tabs .ant-tabs-content-active"),
  ).toContainText("Name");
  const order2 = await columnHeaders(page);
  expect(order2.indexOf("Data")).toBeGreaterThan(order2.indexOf("Write"));
  const typeWidth = await columnWidth(page, "Type");
  expect(typeWidth).toBeGreaterThanOrEqual(105);
  expect(typeWidth).toBeLessThanOrEqual(120);
});
