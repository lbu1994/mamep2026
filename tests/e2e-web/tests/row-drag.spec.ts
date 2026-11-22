import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

/** 默认业务列顺序（selection 列是 antd 内置第一列、无文本，不参与）。 */
const DEFAULT_ORDER = [
  "No",
  "TM",
  "Name",
  "Address[DEC]",
  "WP",
  "Read",
  "Data",
  "Write",
  "Type",
  "Scale",
  "Comment",
];

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
  await expect(
    page.locator('[data-startup-hydrated="true"]'),
  ).toHaveCount(1);
  return errors;
}

/** 活动表的数据行（限定 tr[data-row-key]，排除 rowSelection 表头行）。 */
function dataRows(page: Page) {
  return page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody [data-row-key]",
  );
}

/** 读取当前行 id 顺序（data-row-key）。 */
async function rowKeys(page: Page): Promise<string[]> {
  return dataRows(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-row-key") ?? ""),
  );
}

/** 读取当前业务列顺序（过滤 selection 列等无文本 th）。 */
async function columnHeaders(page: Page): Promise<string[]> {
  return page
    .locator(
      ".register-table-tabs .ant-tabs-content-active .ant-table-thead th",
    )
    .evaluateAll((ths) =>
      ths
        .map((th) => (th.textContent ?? "").trim())
        .filter((text) => text !== ""),
    );
}

/** 把第 fromIndex 行经最右 drag 列 DragHandle 拖到第 toIndex 行中心（行拖拽）。 */
async function dragRowTo(
  page: Page,
  fromIndex: number,
  toIndex: number,
): Promise<void> {
  const from = dataRows(page).nth(fromIndex);
  const to = dataRows(page).nth(toIndex);
  const handle = from.locator('button[aria-label="Drag to reorder"]');
  const fromBox = (await handle.boundingBox()) ?? {
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
  // 先小步移动激活拖拽（PointerSensor 默认立即激活），再移向目标行。
  await page.mouse.move(startX, startY + 8, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 15 });
  await page.mouse.up();
}

test("dragging a row handle reorders the rows", async ({ page }) => {
  const errors = await openApp(page);
  const before = await rowKeys(page);
  expect(before.length).toBeGreaterThanOrEqual(3);
  // 把第 1 行拖到第 3 行：arrayMove 语义 → 第 1 行移到索引 2，原第 2/3 行上移。
  await dragRowTo(page, 0, 2);
  await expect
    .poll(async () => rowKeys(page), { timeout: 3000 })
    .toEqual([before[1], before[2], before[0], ...before.slice(3)]);
  // 行拖拽不改变表头列顺序。
  expect(await columnHeaders(page)).toEqual(DEFAULT_ORDER);
  // 拖拽不产生 console 错误。
  expect(errors).toEqual([]);
});

test("dragging a row handle does not reorder columns", async ({ page }) => {
  const errors = await openApp(page);
  expect(await columnHeaders(page)).toEqual(DEFAULT_ORDER);
  // 把第 1 行拖到第 3 行：仅行顺序变化，表头保持默认。
  await dragRowTo(page, 0, 2);
  await expect
    .poll(async () => columnHeaders(page), { timeout: 3000 })
    .toEqual(DEFAULT_ORDER);
  expect(errors).toEqual([]);
});
