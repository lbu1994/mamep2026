/**
 * 逐行重复控件的可访问名称：
 * - TM / WP / Read / Write / 位开关均包含行号和当前地址；
 * - 地址提交、行重排、虚拟滚动后名称同步更新；
 * - 父行、范围子行与位明细行的键盘焦点顺序保持 DOM 列序。
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15_000,
  });
  await expect(page.locator('[data-startup-hydrated="true"]')).toHaveCount(1);
}

function dataRows(page: Page): Locator {
  return page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody [data-row-key]",
  );
}

async function setAddress(row: Locator, address: string): Promise<void> {
  const input = row.getByLabel("Address", { exact: true });
  await input.click();
  await input.fill(address);
  await input.press("Enter");
}

async function dragRowTo(
  page: Page,
  from: Locator,
  to: Locator,
): Promise<void> {
  const handle = from.locator('button[aria-label="Drag to reorder"]');
  const fromBox = await handle.boundingBox();
  const toBox = await to.boundingBox();
  if (fromBox === null || toBox === null) {
    throw new Error("missing row drag bounds");
  }
  const startX = fromBox.x + fromBox.width / 2;
  const startY = fromBox.y + fromBox.height / 2;
  const endX = toBox.x + toBox.width / 2;
  const endY = toBox.y + toBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 8, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 15 });
  await page.mouse.up();
}

test("父行名称携带行号和地址，并在地址变化、重排后更新", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openApp(page);

  const rows = dataRows(page);
  const first = rows.nth(0);
  const third = rows.nth(2);
  const rowKey = await first.getAttribute("data-row-key");
  if (rowKey === null) throw new Error("missing first row key");

  const poll = first.getByRole("switch", {
    name: "Poll row 1, address 0",
  });
  const read = first.getByRole("button", {
    name: "Read row 1, address 0",
  });
  await expect(read).toBeVisible();
  await expect(
    first.getByRole("button", { name: "Write row 1, address 0" }),
  ).toBeVisible();
  await expect(
    first.getByRole("checkbox", { name: "Trace row 1, address 0" }),
  ).toBeVisible();

  // 父行内焦点仍按 WP → Read → Data → Write 的表头/列序移动。
  await poll.focus();
  await page.keyboard.press("Tab");
  await expect(read).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first.getByLabel("Data", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    first.getByRole("button", { name: "Write row 1, address 0" }),
  ).toBeFocused();

  await setAddress(first, "1000");
  await expect(
    first.getByRole("button", { name: "Read row 1, address 1000" }),
  ).toBeVisible();
  await expect(
    first.getByRole("switch", { name: "Poll row 1, address 1000" }),
  ).toBeVisible();

  await dragRowTo(page, first, third);
  const moved = page.locator(
    `.register-table-tabs .ant-tabs-content-active .ant-table-tbody [data-row-key="${rowKey}"]`,
  );
  await expect(
    moved.getByRole("button", { name: "Read row 3, address 1000" }),
  ).toBeVisible();
});

test("虚拟滚动后的行仍以当前行号和地址区分操作", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openApp(page);

  const holder = page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody-virtual-holder",
  );
  await holder.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  const last = dataRows(page).last();
  await expect(last).toBeVisible();
  const rowNumber = Number.parseInt(
    (await last.locator(".ant-table-cell").nth(1).innerText()).trim(),
    10,
  );
  await setAddress(last, "4321");
  const poll = last.getByRole("switch", {
    name: `Poll row ${rowNumber}, address 4321`,
  });
  const read = last.getByRole("button", {
    name: `Read row ${rowNumber}, address 4321`,
  });

  await expect(poll).toBeVisible();
  await poll.focus();
  await page.keyboard.press("Tab");
  await expect(read).toBeFocused();
});

test("范围父行与位明细的焦点顺序可区分，位开关携带地址", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openApp(page);

  const rows = dataRows(page);
  const range = rows.nth(0);
  const bitParent = rows.nth(1);
  const bitParentKey = await bitParent.getAttribute("data-row-key");
  if (bitParentKey === null) throw new Error("missing bit parent row key");

  await setAddress(range, "0-1");
  await expect(
    range.getByRole("button", { name: "Read row 1, address 0-1" }),
  ).toBeVisible();
  await range.locator('button[aria-label="Expand row"]').click();
  const rangeChildren = page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody [data-row-key*=':c']",
  );
  await expect(rangeChildren).toHaveCount(2);
  await expect(
    rangeChildren.first().getByRole("button", { name: /^Read row / }),
  ).toHaveCount(0);

  const bitParentRow = page.locator(
    `.register-table-tabs .ant-tabs-content-active .ant-table-tbody [data-row-key="${bitParentKey}"]`,
  );
  await setAddress(bitParentRow, "2");
  await bitParentRow.getByLabel("Type").click();
  await page.locator(".ant-select-dropdown:visible [title='Binary']").click();
  await bitParentRow.locator('button[aria-label="Expand row"]').click();

  const bit15 = page
    .locator(
      ".register-table-tabs .ant-tabs-content-active .ant-table-tbody [data-row-key*=':b15']",
    )
    .first();
  const toggle = bit15.getByLabel("Toggle bit 15, row 2, address 2");
  const bitName = bit15.getByLabel("Name");
  const bitComment = bit15.getByLabel("Comment");
  await expect(toggle).toBeVisible();

  // 位行内：Name → Data 位开关 → Comment，跳过的非交互列不制造焦点停靠点。
  await bitName.focus();
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(bitComment).toBeFocused();
});
