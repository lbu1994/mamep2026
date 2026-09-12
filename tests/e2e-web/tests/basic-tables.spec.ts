/**
 * 基础表类型（ADR-043 E-2）E2E（mock 传输）：
 * - 侧边栏基础表分组（Coils / Discrete Inputs / Input Registers）新建表
 * - 线圈表：默认 Type=BOOL；FC01 读（位值）、FC0F 写、写后回读
 * - 离散输入表：只读（Write 禁用）；FC02 读
 * - 输入寄存器表：只读；FC04 读
 * - 通信日志帧断言（FC01/FC0F/FC02/FC04）
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
}

interface MamepMockApi {
  setRegister(address: number, value: number): void;
  getRegister(address: number): number | null;
  setCoil(address: number, value: number): void;
  getCoil(address: number): number | null;
  setInput(address: number, value: number): void;
  getInput(address: number): number | null;
  setInputRegister(address: number, value: number): void;
  getInputRegister(address: number): number | null;
}

async function setCoil(page: Page, address: number, value: number): Promise<void> {
  await page.evaluate(
    ({ a, v }) => {
      (window as unknown as { __mamepMock: MamepMockApi }).__mamepMock.setCoil(
        a,
        v,
      );
    },
    { a: address, v: value },
  );
}

async function getCoil(page: Page, address: number): Promise<number | null> {
  return page.evaluate((a) => {
    return (
      window as unknown as { __mamepMock: MamepMockApi }
    ).__mamepMock.getCoil(a);
  }, address);
}

/** 通过侧边栏分组「+」按钮新建基础表（aria-label = 组标题）。 */
async function addBasicSheet(page: Page, groupTitle: string): Promise<void> {
  await page
    .getByRole("button", { name: groupTitle, exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

function parentRow(page: Page, index: number) {
  return page
    .locator(
      ".register-table-tabs .ant-tabs-content-active .ant-table-tbody tr[data-row-key]",
    )
    .nth(index);
}

/**
 * Mock 自动连接恒用 rtu（初始 holding-register 表）；基础表须在活动表为对应类型时
 * 以对应 codec 协议重连。注意：已连接时弹窗 CONNECT 按钮变「Disconnect」（含子串 connect），
 * 必须先断开再打开弹窗点击 CONNECT（与 app.spec 断开重连流程一致）。
 */
async function reconnectAsActiveSheet(page: Page): Promise<void> {
  // 1) 先断开（已连接时弹窗按钮是 Disconnect，避免误点）。
  await page
    .getByRole("button", { name: /Disconnect/ })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".ant-layout-header")).not.toContainText("Disconnect");
  // 2) 打开 Connection Settings 并以活动表协议连接。
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

test("侧边栏显示基础表分组并可新建线圈表", async ({ page }) => {
  await openApp(page);
  const sider = page.locator(".ant-layout-sider");
  await expect(sider).toContainText("Coils (01H/0FH)");
  await expect(sider).toContainText("Discrete Inputs (02H)");
  await expect(sider).toContainText("Input Registers (04H)");

  await addBasicSheet(page, "Coils (01H/0FH)");
  // 新建线圈表成为活动表；其行默认 Type=BOOL（antd Select 标签渲染在 selection-item，非 combobox 输入框）。
  const first = parentRow(page, 0);
  await expect(first.getByLabel("Type")).toBeVisible();
  await expect(first).toContainText("Bool");
  await expect(first.getByLabel("Scale")).toBeDisabled();
});

test("线圈表：FC01 读位值、FC0F 写 + 写后回读", async ({ page }) => {
  await openApp(page);
  await addBasicSheet(page, "Coils (01H/0FH)");
  // 以线圈表协议重连（mock 自动连接恒 rtu）。
  await reconnectAsActiveSheet(page);

  // 第一行地址 0，预置线圈 0 = 1。
  await setCoil(page, 0, 1);
  const first = parentRow(page, 0);
  const address = first.getByLabel("Register", { exact: true });
  await address.click();
  await address.fill("0");
  await address.press("Enter");

  // FC01 读：Data 显示 1。
  await first
    .getByRole("button", { name: "Read", exact: true })
    .evaluate((el) => (el as HTMLElement).click());
  const dataInput = first.getByLabel("Data");
  await expect(dataInput).toHaveText("1", { timeout: 5000 });

  // 通信日志出现 FC01 请求帧。
  await page
    .getByRole("tab", { name: "Comm Log" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".comm-log__list")).toContainText(
    "01 01 00 00 00 01",
    { timeout: 5000 },
  );

  // 写 0（FC0F）：mock 线圈回读为 0。
  await page
    .getByRole("tab", { name: "Sheet 2" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  const dataInput2 = parentRow(page, 0).getByLabel("Data");
  await dataInput2.click();
  await dataInput2.fill("0");
  await dataInput2.press("Enter");
  await parentRow(page, 0)
    .getByRole("button", { name: "Write", exact: true })
    .evaluate((el) => (el as HTMLElement).click());
  await expect.poll(() => getCoil(page, 0)).toBe(0);
});

test("离散输入表（只读）：Write 禁用、FC02 读", async ({ page }) => {
  await openApp(page);
  await addBasicSheet(page, "Discrete Inputs (02H)");
  await reconnectAsActiveSheet(page);

  // 预置离散输入 1 = 1。
  await page.evaluate(() => {
    (window as unknown as { __mamepMock: MamepMockApi }).__mamepMock.setInput(1, 1);
  });
  const first = parentRow(page, 0);
  const address = first.getByLabel("Register", { exact: true });
  await address.click();
  await address.fill("1");
  await address.press("Enter");

  // 只读：Write 按钮禁用。
  await expect(
    first.getByRole("button", { name: "Write", exact: true }),
  ).toBeDisabled();

  // FC02 读：Data 显示 1（离散输入默认 hex，0x0001）。
  await first
    .getByRole("button", { name: "Read", exact: true })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(first.getByLabel("Data")).toHaveText("0001", { timeout: 5000 });

  // 通信日志出现 FC02 请求帧。
  await page
    .getByRole("tab", { name: "Comm Log" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".comm-log__list")).toContainText(
    "01 02 00 01 00 01",
    { timeout: 5000 },
  );
});

test("输入寄存器表（只读）：FC04 读 16 位值", async ({ page }) => {
  await openApp(page);
  await addBasicSheet(page, "Input Registers (04H)");
  await reconnectAsActiveSheet(page);

  // 预置输入寄存器 2 = 0x1234。
  await page.evaluate(() => {
    (window as unknown as { __mamepMock: MamepMockApi }).__mamepMock.setInputRegister(
      2,
      0x1234,
    );
  });
  const first = parentRow(page, 0);
  const address = first.getByLabel("Register", { exact: true });
  await address.click();
  await address.fill("2");
  await address.press("Enter");

  await expect(
    first.getByRole("button", { name: "Write", exact: true }),
  ).toBeDisabled();

  await first
    .getByRole("button", { name: "Read", exact: true })
    .evaluate((el) => (el as HTMLElement).click());
  // 输入寄存器默认 hex：显示 1234。
  await expect(first.getByLabel("Data")).toHaveText("1234", { timeout: 5000 });

  await page
    .getByRole("tab", { name: "Comm Log" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".comm-log__list")).toContainText(
    "01 04 00 02 00 01",
    { timeout: 5000 },
  );
});
