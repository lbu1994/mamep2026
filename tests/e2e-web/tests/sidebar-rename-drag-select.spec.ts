/**
 * 侧边栏重命名编辑态下 sheet 项不可拖拽 e2e（mockTransport=1，浏览器端，2026-09-08）。
 * Bug：侧边栏 sheet 进入 Rename 编辑态后，想用鼠标选中输入框全文，却把整个 sheet 拖走了。
 * 根因：MamepApp.tsx 的 useEffect 把侧边栏所有 li[data-sheet-id] 的 draggable 设为 true
 * （拖拽排序），编辑输入框渲染在该可拖拽 li 内，鼠标按住+移动被视为「拖拽表项」而非「文本选择」。
 *
 * 复现（红）：
 * - 侧边栏右键 Rename → `.sheet-item__input` 可见；
 * - 断言正在编辑的 li[data-sheet-id] 的 draggable 为 "false" → 修复前全为 "true"，断言失败。
 * 修复（绿）：
 * - 编辑态的 li draggable 为 "false"（可正常选中文本），其余 sheet 项仍为 "true"（拖拽排序不受影响）。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  return errors;
}

function sidebarItem(page: Page, name: string) {
  return page
    .locator(".ant-layout-sider li.sheet-item")
    .filter({ hasText: new RegExp(`^${name}$`) });
}

async function addSheet(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "New Table", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

test("侧边栏 Rename 编辑态：正在编辑的 sheet 项不可拖拽，其余仍可拖拽排序", async ({
  page,
}) => {
  const errors = await openApp(page);
  await addSheet(page);
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 2");

  // 侧边栏右键 Sheet 1 → Rename → 内联输入框出现。
  await sidebarItem(page, "Sheet 1").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Rename" })
    .evaluate((el) => (el as HTMLElement).click());

  const input = page.locator(".sheet-sidebar__list .sheet-item__input");
  await expect(input).toBeVisible();

  // 正在编辑的 li（输入框的祖先 li[data-sheet-id]）不可拖拽 → 可正常用鼠标选中文本。
  const renamingLi = input.locator("xpath=ancestor::li[@data-sheet-id]");
  await expect(renamingLi).toHaveAttribute("draggable", "false");

  // 其余 sheet 项仍可拖拽排序（不因某个重命名而失效）。
  const otherLi = sidebarItem(page, "Sheet 2");
  await expect(otherLi).toHaveAttribute("draggable", "true");

  expect(errors).toEqual([]);
});
