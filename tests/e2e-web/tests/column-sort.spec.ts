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
  "Scale",
  "Comment",
];

/** 语义同 dnd-kit arrayMove：移除 from 处元素并插入到 to 处（其余元素相应移位）。 */
function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items];
  const [moved] = copy.splice(from, 1);
  if (moved === undefined) return copy;
  copy.splice(to, 0, moved);
  return copy;
}

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
  Scale: "scale",
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
  scale: "Scale",
  comment: "Comment",
  drag: "Drag to reorder",
};

/** 连续拖拽序列（2026-08-19 曾稳定复现「多次拖拽后列序错乱」的用例序列）。 */
const DRAG_SEQUENCE: ReadonlyArray<readonly [string, string]> = [
  ["Name", "No"],
  ["Comment", "Data"],
  ["Type", "Write"],
  ["Register[DEC]", "TM"],
  ["Data", "WP"],
  ["Write", "Read"],
  ["Comment", "No"],
  ["Type", "Name"],
  ["Read", "Data"],
  ["WP", "Type"],
  ["Name", "Comment"],
  ["Data", "No"],
  ["Write", "Register[DEC]"],
  ["Comment", "TM"],
  ["Type", "Read"],
];

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

/** 读取当前业务列顺序（过滤 selection 列等无文本 th）。 */
async function columnHeaders(page: Page): Promise<string[]> {
  return tableHeader(page)
    .locator("th")
    .evaluateAll((ths) =>
      ths
        .map((th) => (th.textContent ?? "").trim())
        .filter((text) => text !== ""),
    );
}

/**
 * 读取 body 第一行各 td 的顺序标识：优先取单元格内 [aria-label]，否则取文本。
 * 用于断言「列拖拽后数据列同步跟随表头」（表头/数据不错位）。
 * 注意：必须限定 tr.ant-table-row（真实数据行），antd 的 rowSelection 表头行
 * （含 Custom selection 下拉）也在 .ant-table-tbody 内，直接取第一个 tr 会误匹配表头。
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

test("dragging a column header reorders the columns", async ({ page }) => {
  const errors = await openApp(page);
  expect(await columnHeaders(page)).toEqual(DEFAULT_ORDER);
  // 把 Name 拖到 No 上：Name 移到 No 的位置（selection 列之后第一列）。
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
      "Scale",
      "Comment",
    ]);
  // body 数据列必须同步跟随表头（不允许表头/数据错位）。
  const labels = await firstRowCellLabels(page);
  expect(labels.indexOf("Name")).toBe(1);
  expect(labels.indexOf("1")).toBe(2);
  expect(labels.indexOf("Register")).toBe(4);
  // 拖拽不产生 console 错误。
  expect(errors).toEqual([]);
});

test("the selection checkbox column cannot be dragged", async ({ page }) => {
  const errors = await openApp(page);
  // 尝试把第一列（selection 列）拖到 Name 上：列顺序应保持不变。
  const selectionCell = tableHeader(page).locator("th").first();
  const selectionBox = (await selectionCell.boundingBox()) ?? {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  const nameBox = (await headerCell(page, "Name").boundingBox()) ?? {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  await page.mouse.move(
    selectionBox.x + selectionBox.width / 2,
    selectionBox.y + selectionBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    nameBox.x + nameBox.width / 2,
    nameBox.y + nameBox.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  expect(await columnHeaders(page)).toEqual(DEFAULT_ORDER);
  expect(errors).toEqual([]);
});

test("column order persists across a page reload", async ({ page }) => {
  await openApp(page);
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
      "Scale",
      "Comment",
    ]);
  // 等待 IndexedDB 自动保存落盘（AppHost 防抖 500ms + 异步写入），避免刷新竞态。
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  // 刷新后列顺序恢复（workspace 恢复），不回默认顺序。
  expect(await columnHeaders(page)).toEqual([
    "Name",
    "No",
    "TM",
    "Register[DEC]",
    "WP",
    "Read",
    "Data",
    "Write",
    "Type",
    "Scale",
    "Comment",
  ]);
});

test("column order is independent per tab (不共享)", async ({ page }) => {
  await openApp(page);
  // 表 1：把 Name 拖到最前。
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
      "Scale",
      "Comment",
    ]);
  // 新建表 2（侧边栏添加入口，自动激活）。
  await page
    .getByRole("button", { name: "New Register Table", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(
    page.locator(".register-table-tabs .ant-tabs-content-active"),
  ).toContainText("Name");
  // 表 2 为默认顺序（与表 1 不共享）。
  expect(await columnHeaders(page)).toEqual(DEFAULT_ORDER);
  // 切回表 1：仍保持拖拽后的顺序。
  await page
    .locator(".register-table-tabs div[role=tab]")
    .filter({ hasText: "Sheet 1" })
    .click();
  await expect(
    page.locator(".register-table-tabs .ant-tabs-content-active"),
  ).toContainText("Name");
  expect(await columnHeaders(page)).toEqual([
    "Name",
    "No",
    "TM",
    "Register[DEC]",
    "WP",
    "Read",
    "Data",
    "Write",
    "Type",
    "Scale",
    "Comment",
  ]);
});

test("repeated column drags (15×) keep the exact order and sync body rows", async ({
  page,
}) => {
  const errors = await openApp(page);
  let expected = [...DEFAULT_ORDER];
  for (const [from, to] of DRAG_SEQUENCE) {
    await dragColumnTo(page, from, to);
    // 每次拖拽后按 arrayMove 语义推进预期顺序（与领域层 moveRowToIndex 同款语义）。
    const fromIndex = expected.indexOf(from);
    const toIndex = expected.indexOf(to);
    if (fromIndex >= 0 && toIndex >= 0) {
      expected = arrayMove(expected, fromIndex, toIndex);
    }
    // 表头列序必须精确等于预期：被拖列落对位、未拖列位置不变（多次拖拽不得累积漂移）。
    expect(await columnHeaders(page)).toEqual(expected);
  }
  // 最终 body 数据行列顺序与表头同步（不允许表头/数据错位）。
  // 注意：body 首行首列为 rowSelection 复选框（antd 生成 aria-label="Select row 1"），
  // 最右为 drag 列手柄（label="Drag to reorder"），本序列未拖它、恒在末尾。
  const bodyLabels = await firstRowCellLabels(page);
  expect(bodyLabels).toEqual([
    "Select row 1",
    ...expected.map((header) => {
      const key = HEADER_TO_KEY[header];
      return key === undefined ? "" : (BODY_LABEL_BY_COLUMN[key] ?? "");
    }),
    "Drag to reorder",
  ]);
  // 拖拽全程无 console 错误。
  expect(errors).toEqual([]);
});
