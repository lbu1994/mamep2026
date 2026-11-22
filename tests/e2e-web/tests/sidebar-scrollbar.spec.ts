import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 显示 Online 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  return errors;
}

/**
 * 侧边栏展开态，协议分组标题文本过长时不得产生水平滚动条。
 * 分组标题收缩并省略号显示（flex:1;min-width:0），分组容器填满剩余高度（flex:1）。
 */
test("expanded sidebar has no horizontal scrollbar even with long group titles", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await openApp(page);

  // 侧边栏分组容器（.sheet-sidebar__groups，overflow:auto）不应产生水平溢出/滚动条。
  const groups = await page
    .locator(".sheet-sidebar__groups")
    .evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
  expect(groups.scrollWidth).toBeLessThanOrEqual(groups.clientWidth);

  // 侧边栏容器自身亦无水平溢出。
  const sidebar = await page
    .locator(".sheet-sidebar.ant-layout-sider")
    .evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
  expect(sidebar.scrollWidth).toBeLessThanOrEqual(sidebar.clientWidth);

  expect(errors).toEqual([]);
});
