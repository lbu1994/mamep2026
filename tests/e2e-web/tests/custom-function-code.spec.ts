/**
 * 自定义功能码示例插件（ADR-043 E-4）E2E（mock 传输）：
 * - 侧边栏显示 "Custom FC 65H/66H" 分组并可新建自定义表
 * - 以 custom-function-code 协议重连后 FC65 读 / FC66 写闭环
 * - 插件 dataType（custom-function-code:scaled）出现在 Type 下拉且可编辑
 */
import { expect, test, type Page } from "@playwright/test";
import { installExecutablePlugin } from "./helpers/manual-plugins";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  // ADR-054：示例插件不再随包安装——先手动安装并授权同进程执行
  // （codec 与插件 dataType 均为同步注册面）。
  await installExecutablePlugin(page, {
    pluginId: "custom-function-code",
    pluginName: "Custom Function Code",
    executionMode: "same-process",
  });
}

function parentRow(page: Page, index: number) {
  return page
    .locator(
      ".register-table-tabs .ant-tabs-content-active .ant-table-tbody tr[data-row-key]",
    )
    .nth(index);
}

/** 先断开（已连接时弹窗按钮是 Disconnect），再以活动表协议连接。 */
async function reconnectAsActiveSheet(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /Disconnect/ })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".ant-layout-header")).not.toContainText("Disconnect");
  await page
    .getByRole("button", { name: "Connection" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".ant-modal-container:visible", { timeout: 5000 });
  await page
    .locator(".ant-modal-container:visible .ant-btn")
    .filter({ hasText: "CONNECT" })
    .evaluate((el) => (el as HTMLElement).click());
  await page
    .waitForSelector(".ant-modal-container:visible", {
      state: "hidden",
      timeout: 5000,
    })
    .catch(() => undefined);
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect");
}

test("侧边栏显示自定义功能码分组并可新建表；FC65 读 / FC66 写闭环", async ({
  page,
}) => {
  await openApp(page);
  const sider = page.locator(".ant-layout-sider");
  await expect(sider).toContainText("Custom FC 65H/66H (example plugin)");

  // 新建自定义功能码表（aria-label = 组标题）。
  await page
    .getByRole("button", {
      name: "Custom FC 65H/66H (example plugin)",
      exact: true,
    })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await reconnectAsActiveSheet(page);

  // 预置寄存器 1 = 0x1234；FC65 读。
  await page.evaluate(() => {
    (window as unknown as { __mamepMock: { setRegister(a: number, v: number): void } }).__mamepMock.setRegister(1, 0x1234);
  });
  const first = parentRow(page, 0);
  const address = first.getByLabel("Address", { exact: true });
  await address.click();
  await address.fill("1");
  await address.press("Enter");
  await first
    .getByRole("button", { name: "Read", exact: true })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(first.getByLabel("Data")).toHaveText("1234", { timeout: 5000 });

  // 通信日志出现 0x65 请求帧。
  await page
    .getByRole("tab", { name: "Comm Log" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".comm-log__list")).toContainText(
    "01 65 00 01 00 01",
    { timeout: 5000 },
  );

  // FC66 写：mock 寄存器更新。
  await page
    .getByRole("tab", { name: "Sheet 2" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  const dataInput = parentRow(page, 0).getByLabel("Data");
  await dataInput.click();
  await dataInput.fill("00AB");
  await dataInput.press("Enter");
  await parentRow(page, 0)
    .getByRole("button", { name: "Write", exact: true })
    .evaluate((el) => (el as HTMLElement).click());
  await expect
    .poll(() =>
      page.evaluate(() => {
        return (
          window as unknown as { __mamepMock: { getRegister(a: number): number | null } }
        ).__mamepMock.getRegister(1);
      }),
    )
    .toBe(0xab);
});

test("插件 dataType 出现在 Type 下拉且可解析（scaled x0.1）", async ({
  page,
}) => {
  await openApp(page);
  const first = parentRow(page, 0);
  // 打开 Type 下拉：可见内置选项 + 插件类型。
  await first.getByLabel("Type").click();
  await expect(
    page.locator(".ant-select-dropdown:visible [title='Scaled (x0.1, example)']"),
  ).toBeVisible();
  // 选择插件类型。
  await page
    .locator(".ant-select-dropdown:visible [title='Scaled (x0.1, example)']")
    .click();
  await expect(first).toContainText("Scaled (x0.1, example)");
  // Data 输入 "12.5" → 提交后（未连接无法读，只验证解析不报错/保留）。
  const dataInput = first.getByLabel("Data");
  await dataInput.click();
  await dataInput.fill("12.5");
  await dataInput.press("Enter");
  // 编辑完成（校验通过）后文本保留。
  await expect(dataInput).toHaveText("12.5");
});
