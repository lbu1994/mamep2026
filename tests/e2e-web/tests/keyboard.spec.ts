/**
 * 「更完整的键盘操作」e2e（PRD §8.3 P1，2026-08-30，ADR-037）。
 * 覆盖 app 级（Ctrl+/、?、Ctrl+,、Ctrl+Enter、Ctrl+[ / Ctrl+]）与表格级
 * （F9、↑/↓、Alt+P）快捷键在真实浏览器（mockTransport）中的闭环，全程无 console 错误。
 * 运行前提：pnpm dev（http://localhost:5173）。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  // 等待寄存器表渲染完成：此时 React 初始提交与副作用（全局 keydown 监听）均已就绪，
  // 避免首用例在监听器绑定前按键（偶发时序）。
  await expect(page.locator(".register-table-tabs .ant-table")).toBeVisible();
}

function row(page: Page, index: number) {
  return page.locator(".ant-table-tbody tr[data-row-key]").nth(index);
}

function rowCheckbox(page: Page, index: number) {
  return row(page, index).locator(
    "td.ant-table-selection-column .ant-checkbox-input",
  );
}

test("Ctrl+/ 打开帮助弹窗并展示快捷键总览（app/table 两组）", async ({
  page,
}) => {
  await openApp(page);
  await page.keyboard.press("Control+/");
  // 注：不用 getByRole("heading")——antd Modal 内的 role/可访问性树匹配不稳定，
  // 改用类名定位（文本断言语义等价，稳定性优先）。
  const title = page.locator(".keyboard-shortcuts__title");
  await expect(title).toHaveText("Keyboard Shortcuts");
  await expect(page.locator(".keyboard-shortcuts__table")).toHaveCount(2);
  // 关闭后 ?（Shift+/）也可打开（别名）。
  await page.keyboard.press("Escape");
  await expect(title).toBeHidden();
  await page.keyboard.press("Shift+/");
  await expect(title).toHaveText("Keyboard Shortcuts");
});

test("Ctrl+, 打开设置弹窗", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("Control+,");
  await expect(page.getByText("Theme")).toBeVisible();
});

test("Ctrl+Enter 断开连接；再按打开连接设置弹窗", async ({ page }) => {
  await openApp(page);
  // 已连接（mock 自动连接）→ Ctrl+Enter 断开。
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".ant-layout-header")).not.toContainText(
    "Disconnect",
    { timeout: 15000 },
  );
  // 再按 → 打开连接设置弹窗。
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("Connection Settings")).toBeVisible();
});

test("F9 全表读取（Read All 完成全局提示出现）", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("F9");
  await expect(page.locator(".read-all-result")).toBeVisible({
    timeout: 15000,
  });
});

test("Ctrl+[ / Ctrl+] 在打开的表间循环切换", async ({ page }) => {
  await openApp(page);
  // 新建第二张表（侧边栏核心组 + 按钮）。
  await page
    .locator('.sheet-sidebar__group-head[data-sheet-group="holding-register"] .sheet-sidebar__group-action')
    .click();
  await expect(
    page.locator(".register-table-tabs .ant-tabs-tab-active"),
  ).toContainText("Sheet 2");
  // 上一个表。
  await page.keyboard.press("Control+[");
  await expect(
    page.locator(".register-table-tabs .ant-tabs-tab-active"),
  ).toContainText("Sheet 1");
  // 下一个表。
  await page.keyboard.press("Control+]");
  await expect(
    page.locator(".register-table-tabs .ant-tabs-tab-active"),
  ).toContainText("Sheet 2");
});

test("↑/↓ 移动选中行，Alt+P 切换选中行轮询", async ({ page }) => {
  await openApp(page);
  // 选中第 1 行（焦点落在复选框上）。
  await rowCheckbox(page, 0).check();
  await expect(rowCheckbox(page, 0)).toBeChecked();
  // 方向键下移：选中行移到第 2 行（替换单选）。
  await page.keyboard.press("ArrowDown");
  await expect(rowCheckbox(page, 1)).toBeChecked();
  await expect(rowCheckbox(page, 0)).not.toBeChecked();
  // Alt+P：切换选中行（第 2 行）的 WP 轮询开关。
  const wpSwitch = row(page, 1).locator(".ant-switch");
  const before = await wpSwitch.getAttribute("aria-checked");
  await page.keyboard.press("Alt+p");
  await expect(wpSwitch).toHaveAttribute(
    "aria-checked",
    before === "true" ? "false" : "true",
  );
});

test("键盘操作全程无 console 错误", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await openApp(page);
  await page.keyboard.press("Control+/");
  await expect(page.locator(".keyboard-shortcuts__title")).toHaveText(
    "Keyboard Shortcuts",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("F9");
  await page.waitForTimeout(800);
  await page.keyboard.press("Control+,");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  expect(errors).toEqual([]);
});
