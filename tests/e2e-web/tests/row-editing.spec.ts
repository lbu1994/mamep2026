import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 DISCONNECT 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("DISCONNECT", {
    timeout: 15000,
  });
}

function row(page: Page, index: number) {
  return page.locator(".ant-table-tbody tr[data-row-key]").nth(index);
}

async function addRows(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await page.getByRole("button", { name: "Add Row" }).first().click();
  }
}

async function fillRow(
  page: Page,
  index: number,
  data: { name: string; address: string },
): Promise<void> {
  await row(page, index).getByLabel("Name").fill(data.name);
  const addressInput = row(page, index).getByLabel("Register");
  await addressInput.fill(data.address);
  await addressInput.press("Enter");
}

function selectionCheckbox(page: Page, index: number) {
  return row(page, index).locator(
    "td.ant-table-selection-column .ant-checkbox-input",
  );
}

test("row context menu inserts an empty row below the target", async ({
  page,
}) => {
  await openApp(page);
  await addRows(page, 1);
  await fillRow(page, 0, { name: "R1", address: "100" });

  // 右键目标行弹出菜单，包含全部行编辑项。
  await row(page, 0).locator("td").nth(3).click({ button: "right" });
  const menu = page.locator(".ant-dropdown-menu:visible");
  await expect(menu).toBeVisible();
  for (const item of [
    "Insert Row Above",
    "Insert Row Below",
    "Move Up",
    "Move Down",
    "Copy",
    "Cut",
    "Paste",
    "Delete Row",
  ]) {
    await expect(
      menu.locator(".ant-dropdown-menu-item", { hasText: item }),
    ).toHaveCount(1);
  }

  // 在选中行下方插入空行，不继承字段。
  await menu
    .locator(".ant-dropdown-menu-item", { hasText: "Insert Row Below" })
    .click();
  await expect(page.locator(".ant-table-tbody tr[data-row-key]")).toHaveCount(
    2,
  );
  await expect(row(page, 1).getByLabel("Name")).toHaveValue("");
  await expect(row(page, 1).getByLabel("Register")).toHaveValue("");
});

test("checkbox multi-select, shift range and select-all update the toolbar", async ({
  page,
}) => {
  await openApp(page);
  await addRows(page, 4);

  // 逐行勾选实现多选。
  await selectionCheckbox(page, 0).click();
  await selectionCheckbox(page, 2).click();
  await expect(page.locator(".table-toolbar")).toContainText("2 selected");

  // Shift+Click 范围选择（antd rowSelection 原生）。
  await selectionCheckbox(page, 3).click({ modifiers: ["Shift"] });
  await expect(page.locator(".table-toolbar")).toContainText("3 selected");

  // 表头全选。
  await page
    .locator(".ant-table-thead .ant-table-selection-column .ant-checkbox-input")
    .click();
  await expect(page.locator(".table-toolbar")).toContainText("4 selected");
});

test("copy and paste via keyboard preserves row data", async ({ page }) => {
  await openApp(page);
  await addRows(page, 2);
  await fillRow(page, 0, { name: "R1", address: "100" });
  await fillRow(page, 1, { name: "R2", address: "200" });

  // 表头全选后 Ctrl+C / Ctrl+V（焦点在复选框，快捷键应仍生效）。
  await page
    .locator(".ant-table-thead .ant-table-selection-column .ant-checkbox-input")
    .click();
  await expect(page.locator(".table-toolbar")).toContainText("2 selected");

  await page.keyboard.press("Control+c");
  await page.waitForTimeout(150);
  await page.keyboard.press("Control+v");
  await expect(page.locator(".ant-table-tbody tr[data-row-key]")).toHaveCount(
    4,
  );
  await expect(row(page, 2).getByLabel("Name")).toHaveValue("R1");
  await expect(row(page, 3).getByLabel("Name")).toHaveValue("R2");
  // 粘贴行的地址按目标表进制重新格式化。
  await expect(row(page, 2).getByLabel("Register")).toHaveValue("100");
});

test("keyboard Delete removes selected rows and clears selection", async ({
  page,
}) => {
  await openApp(page);
  await addRows(page, 3);

  await selectionCheckbox(page, 0).click();
  await selectionCheckbox(page, 2).click();
  await expect(page.locator(".table-toolbar")).toContainText("2 selected");

  await page.keyboard.press("Delete");
  await expect(page.locator(".ant-table-tbody tr[data-row-key]")).toHaveCount(
    1,
  );
  await expect(page.locator(".table-toolbar")).not.toContainText("selected");
});
