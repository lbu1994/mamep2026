/**
 * 插件寄存器手册（ADR-043 E-5）E2E（mock 传输）：
 * - Help 弹窗渲染 documentation 贡献点（安川 MEMOBUS 手册）
 * - 轻量 markdown 渲染（标题/列表/代码块）
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
}

async function openHelp(page: Page): Promise<void> {
  const help = page.locator(".ant-layout-header").getByRole("button", {
    name: /Help/i,
  });
  if ((await help.count()) === 0) {
    // 窄窗口：Help 在 More 下拉内。
    await page
      .locator(".ant-layout-header")
      .getByRole("button", { name: /More/i })
      .first()
      .evaluate((el) => (el as HTMLElement).click());
    await page
      .locator(".ant-dropdown:visible")
      .getByText("Help")
      .first()
      .evaluate((el) => (el as HTMLElement).click());
  } else {
    await help.first().evaluate((el) => (el as HTMLElement).click());
  }
  await page.waitForSelector(".ant-drawer-section:visible", { timeout: 5000 });
}

async function openTab(page: Page, name: string): Promise<void> {
  await page
    .locator(".ant-drawer-section:visible")
    .getByRole("tab", { name })
    .click();
}

test("Help 抽屉「插件文档」页签渲染安川 MEMOBUS 寄存器手册（documentation 贡献点）", async ({
  page,
}) => {
  await openApp(page);
  await openHelp(page);

  const drawer = page.locator(".ant-drawer-section:visible");
  // 抽屉默认「快速上手」页签。
  await expect(drawer).toContainText("Getting Started");
  // 切到「插件文档」页签。
  await openTab(page, "Plugin Documentation");

  await expect(drawer).toContainText("Yaskawa MEMOBUS Register Manual");
  // 手册内容（markdown 渲染）：功能码、帧结构、异常。
  await expect(drawer).toContainText("67H 010DH");
  await expect(drawer).toContainText("67H 010EH");
  await expect(drawer).toContainText("非连续读（数量 1~120）");
  await expect(drawer).toContainText("从站 + 67H + 01H + 0DH");
  // 关闭后重开仍渲染（无 console 错误由全局断言覆盖）。
  await drawer
    .locator(".ant-drawer-close")
    .evaluate((el) => (el as HTMLElement).click());
  await page
    .waitForSelector(".ant-drawer-section:visible", { state: "hidden" })
    .catch(() => undefined);
  await openHelp(page);
  await openTab(page, "Plugin Documentation");
  await expect(page.locator(".ant-drawer-section:visible")).toContainText(
    "Yaskawa MEMOBUS Register Manual",
  );
});
