/**
 * 「更完整的键盘操作」e2e（PRD §8.3 P1）。
 * 覆盖 app 级（Ctrl+/、?、Ctrl+、Ctrl+Enter、Ctrl+[ / Ctrl+]）与表格级
 * （F9、↑/↓、Alt+P）快捷键在真实浏览器（mockTransport）中的闭环，全程无 console 错误。
 * 运行前提：pnpm dev（http://localhost:5173）。
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 显示 Online 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
  // 等待寄存器表渲染完成：此时 React 初始提交与副作用（全局 keydown 监听）均已就绪，
  // 避免首用例在监听器绑定前按键（偶发时序）。
  await expect(page.locator(".register-table-tabs .ant-table")).toBeVisible();
}

function row(page: Page, index: number) {
  return page.locator(".ant-table-tbody [data-row-key]").nth(index);
}

function rowCheckbox(page: Page, index: number) {
  return row(page, index).locator(
    ".ant-table-selection-column .ant-checkbox-input",
  );
}

test("Ctrl+/ 打开帮助抽屉并展示快捷键总览（app/table 两组）", async ({
  page,
}) => {
  await openApp(page);
  await page.keyboard.press("Control+/");
  await page.waitForSelector(".ant-drawer.ant-drawer-open", { timeout: 5000 });
  // 抽屉默认「快速上手」页签，切到「键盘快捷键」后表格才挂载。
  await page
    .locator(".ant-drawer-section:visible")
    .getByRole("tab", { name: "Keyboard Shortcuts" })
    .click();
  const title = page.locator(".keyboard-shortcuts__title");
  await expect(title).toHaveText("Keyboard Shortcuts");
  await expect(page.locator(".keyboard-shortcuts__table")).toHaveCount(2);
  // 关闭后重开（? 别名由 useGlobalShortcuts 单测覆盖：Playwright 无法模拟 "?" 键位，
  // 其 press("Shift+/") 产生 key:"/"+shift，press("?") 产生 key:"?" 无 shift，均不匹配）。
  await page.keyboard.press("Escape");
  await expect(title).toBeHidden();
  await page.keyboard.press("Control+/");
  await page.waitForSelector(".ant-drawer.ant-drawer-open", { timeout: 5000 });
  await page
    .locator(".ant-drawer-section:visible")
    .getByRole("tab", { name: "Keyboard Shortcuts" })
    .click();
  await expect(title).toHaveText("Keyboard Shortcuts");
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
    .locator(
      '.sheet-sidebar__group-head[data-sheet-group="holding-register"] .sheet-sidebar__group-action',
    )
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
  const wpSwitch = row(page, 1).locator(".register-table__wp-switch");
  const before = await wpSwitch.getAttribute("aria-checked");
  await page.keyboard.press("Alt+p");
  await expect(wpSwitch).toHaveAttribute(
    "aria-checked",
    before === "true" ? "false" : "true",
  );
});
