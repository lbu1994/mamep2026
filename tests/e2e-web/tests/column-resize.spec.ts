import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 DISCONNECT 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("DISCONNECT", {
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

test("fixed-width columns expose a resize handle; the flexible Comment column does not", async ({
  page,
}) => {
  await openApp(page);
  // 固定宽列都应有拖拽手柄。
  for (const label of ["Name", "Register", "Data", "Type", "WP", "WRITE"]) {
    await expect(
      headerCell(page, label).locator(".react-resizable-handle"),
    ).toHaveCount(1);
  }
  // Comment 为弹性列（不设固定宽，否则 table-layout:fixed 会按容器比例拉伸全部列导致列宽失真），
  // 因此不提供拖拽手柄；其宽度可通过拖其相邻列间接调整。
  await expect(
    headerCell(page, "Comment").locator(".react-resizable-handle"),
  ).toHaveCount(0);
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
