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
  await page.waitForSelector(".ant-modal-container:visible", { timeout: 5000 });
}

test("Help 弹窗渲染安川 MEMOBUS 寄存器手册（documentation 贡献点）", async ({
  page,
}) => {
  await openApp(page);
  await openHelp(page);

  const modal = page.locator(".ant-modal-container:visible");
  await expect(modal).toContainText("Yaskawa MEMOBUS Register Manual");
  // 手册内容（markdown 渲染）：功能码、帧结构、异常。
  await expect(modal).toContainText("67H 010DH");
  await expect(modal).toContainText("67H 010EH");
  await expect(modal).toContainText("非连续读（数量 1~120）");
  await expect(modal).toContainText("从站 + 67H + 01H + 0DH");
  // 关闭后重开仍渲染（无 console 错误由全局断言覆盖）。
  await modal.getByRole("button", { name: "Close" }).evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".ant-modal-container:visible", { state: "hidden" }).catch(() => undefined);
  await openHelp(page);
  await expect(page.locator(".ant-modal-container:visible")).toContainText(
    "Yaskawa MEMOBUS Register Manual",
  );
});
