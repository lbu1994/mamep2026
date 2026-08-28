import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
}

function row(page: Page, index: number) {
  return page.locator(".ant-table-tbody tr[data-row-key]").nth(index);
}

async function rowCount(page: Page): Promise<number> {
  return page.locator(".ant-table-tbody tr[data-row-key]").count();
}

function undoButton(page: Page) {
  return page.getByRole("button", { name: "Undo" });
}

function redoButton(page: Page) {
  return page.getByRole("button", { name: "Redo" });
}

/** 点击进入 Name 单元格编辑态，填入新名字并提交（可编辑单元格「点击进入编辑」交互）。 */
async function setName(page: Page, index: number, name: string): Promise<void> {
  const nameInput = row(page, index).getByLabel("Name");
  await nameInput.click();
  await nameInput.fill(name);
  await nameInput.press("Enter");
}

test("工具栏撤销/重做按钮：初始禁用，改名后可撤销与重做", async ({ page }) => {
  await openApp(page);
  await expect(undoButton(page)).toBeDisabled();
  await expect(redoButton(page)).toBeDisabled();

  await setName(page, 0, "UndoMe");
  await expect(row(page, 0).getByLabel("Name")).toHaveText("UndoMe");
  await expect(undoButton(page)).toBeEnabled();
  await expect(redoButton(page)).toBeDisabled();

  await undoButton(page).click();
  await expect(row(page, 0).getByLabel("Name")).not.toHaveText("UndoMe");
  await expect(undoButton(page)).toBeDisabled();
  await expect(redoButton(page)).toBeEnabled();

  await redoButton(page).click();
  await expect(row(page, 0).getByLabel("Name")).toHaveText("UndoMe");
  await expect(undoButton(page)).toBeEnabled();
  await expect(redoButton(page)).toBeDisabled();
});

test("快捷键 Ctrl+Z 撤销、Ctrl+Shift+Z 与 Ctrl+Y 重做", async ({ page }) => {
  await openApp(page);
  await setName(page, 0, "Hotkey");
  await expect(row(page, 0).getByLabel("Name")).toHaveText("Hotkey");

  // 提交后焦点回到 body（编辑态 Input 已卸载），快捷键直达表格全局监听。
  await page.keyboard.press("Control+z");
  await expect(row(page, 0).getByLabel("Name")).not.toHaveText("Hotkey");

  await page.keyboard.press("Control+Shift+z");
  await expect(row(page, 0).getByLabel("Name")).toHaveText("Hotkey");

  await page.keyboard.press("Control+z");
  await expect(row(page, 0).getByLabel("Name")).not.toHaveText("Hotkey");
  await page.keyboard.press("Control+y");
  await expect(row(page, 0).getByLabel("Name")).toHaveText("Hotkey");
});

test("新增行可撤销（一次撤销移除、重做恢复）", async ({ page }) => {
  await openApp(page);
  const base = await rowCount(page);
  await page.getByRole("button", { name: "Add Row" }).first().click();
  await expect(page.locator(".ant-table-tbody tr[data-row-key]")).toHaveCount(
    base + 1,
  );

  await undoButton(page).click();
  await expect(page.locator(".ant-table-tbody tr[data-row-key]")).toHaveCount(
    base,
  );

  await redoButton(page).click();
  await expect(page.locator(".ant-table-tbody tr[data-row-key]")).toHaveCount(
    base + 1,
  );
});

test("删除行可撤销恢复（含行内容）与重做", async ({ page }) => {
  await openApp(page);
  await setName(page, 0, "RowToDelete");
  // 勾选第一行并按 Delete 删除（checkbox 聚焦不拦截 Delete，deleteSelectedRows 走 store 入栈）。
  await row(page, 0)
    .locator("td.ant-table-selection-column .ant-checkbox-input")
    .check();
  await page.keyboard.press("Delete");
  await expect(row(page, 0).getByLabel("Name")).not.toHaveText("RowToDelete");

  // 撤销：恢复被删行（含其名字等内容）。
  await undoButton(page).click();
  await expect(row(page, 0).getByLabel("Name")).toHaveText("RowToDelete");

  // 重做：再次删除。
  await redoButton(page).click();
  await expect(row(page, 0).getByLabel("Name")).not.toHaveText("RowToDelete");
});

test("Data 单元格编辑不产生撤销步骤（§20.4）", async ({ page }) => {
  await openApp(page);
  await expect(undoButton(page)).toBeDisabled();
  const dataInput = row(page, 0).getByLabel("Data");
  await dataInput.click();
  await dataInput.fill("1234");
  await dataInput.press("Enter");
  await expect(row(page, 0).getByLabel("Data")).toHaveText("1234");
  // Data 编辑不入栈：撤销按钮保持禁用。
  await expect(undoButton(page)).toBeDisabled();
});

test("撤销/重做交互无 console 错误", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await openApp(page);
  await setName(page, 0, "NoConsole");
  await undoButton(page).click();
  await redoButton(page).click();
  await page.getByRole("button", { name: "Add Row" }).first().click();
  await undoButton(page).click();
  await page.waitForTimeout(500);

  expect(errors).toEqual([]);
});
