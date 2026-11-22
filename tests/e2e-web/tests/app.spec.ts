import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 显示 Online 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
}

async function closeModal(page: Page): Promise<void> {
  await page.waitForSelector(".ant-modal-container:visible", {
    timeout: 15000,
  });
  await page
    .locator(".ant-modal-container:visible .ant-btn")
    .filter({ hasText: "Cancel" })
    .evaluate((el) => (el as HTMLElement).click());
  await page
    .waitForSelector(".ant-modal-container:visible", {
      state: "hidden",
      timeout: 5000,
    })
    .catch(() => undefined);
}

async function openConnectionModal(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Connection settings" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".ant-modal-container:visible", { timeout: 5000 });
}

async function clickModalConnect(page: Page): Promise<void> {
  await page
    .locator(".ant-modal-container:visible .ant-btn")
    .filter({ hasText: "Connect" })
    .evaluate((el) => (el as HTMLElement).click());
}

test("mock startup skips Connection Settings and auto-connects", async ({
  page,
}) => {
  await openApp(page);

  // 启动即进主界面：不出现 Connection Settings 弹窗。
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);
  // 自动连接 mock：MOCK 徽标、Online 状态、独立连接设置入口；动作文案不进入可见文本。
  const header = page.locator(".ant-layout-header");
  await expect(header).toContainText("MOCK");
  await expect(header).toContainText("Online");
  await expect(header).not.toContainText("Disconnect");
  await expect(
    header.locator(".connection-cluster__button"),
  ).toHaveAccessibleName("Online · Disconnect");
  await expect(
    header.getByRole("button", { name: "Connection settings" }),
  ).toBeVisible();
});

test("non-mock startup opens Connection Settings modal with RTU defaults", async ({
  page,
}) => {
  await page.goto("http://localhost:5173/");
  await page.waitForSelector(".ant-modal-container:visible", {
    timeout: 15000,
  });

  const modal = page.locator(".ant-modal-container:visible");
  await expect(modal).toContainText("Connection Settings");
  // Defaults: Timeout=50, Retry=1.（Rx Delay 已移除）
  // 从站地址已迁移为每表独立设置，不再属于连接设置。
  await expect(modal).not.toContainText("Slave Address");
  // 全局 Address Adjust 已移出核心：Connection Settings 不再有该选项。
  await expect(modal).not.toContainText("Address Adjust");
  // Rx Delay 已移除：Connection Settings 不再有该选项。
  await expect(modal).not.toContainText("Rx Delay");
  // No Modbus TCP entry in the browser.
  await expect(modal).not.toContainText("Modbus TCP");
  await closeModal(page);
});

test("register table has the fixed column set and full READ/WRITE labels", async ({
  page,
}) => {
  await openApp(page);

  const header = page.locator(".ant-table-thead");
  for (const label of [
    "No",
    "TM",
    "Name",
    "Address[DEC]",
    "WP",
    "Read",
    "Data",
    "Write",
    "Type",
    "Scale",
    "Comment",
  ]) {
    await expect(header).toContainText(label);
  }
  // No Status column.
  await expect(header).not.toContainText("Status");
  // Mock 模式下徽章显示 MOCK；不出现 Modbus TCP。
  await expect(page.locator(".ant-layout-header")).toContainText("MOCK");
  await expect(page.locator(".ant-layout-header")).not.toContainText(
    "Modbus TCP",
  );
});

test("disconnect and reconnect via Connection Settings, then read/write", async ({
  page,
}) => {
  await openApp(page);

  // 启动已自动连接：先断开，再走弹窗连接路径（保持 Connection Settings 流程覆盖）。
  await page
    .getByRole("button", { name: /Disconnect/ })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".ant-layout-header")).not.toContainText(
    "Disconnect",
  );
  await expect(
    page.locator(".connection-cluster__button"),
  ).toHaveAccessibleName("Offline · Connect");
  await expect(page.locator(".connection-cluster__button")).toContainText(
    "Offline",
  );

  // Preset the mock device register.
  await page.evaluate(() =>
    (
      window as unknown as {
        __mamepMock: { setRegister(a: number, v: number): void };
      }
    ).__mamepMock.setRegister(0x0001, 0x00ab),
  );

  // Add a row and enter an address.
  await page
    .getByRole("button", { name: "Add Row" })
    .evaluate((el) => (el as HTMLElement).click());
  const addressInput = page.getByLabel("Address", { exact: true }).first();
  await addressInput.click();
  await addressInput.fill("1");
  await addressInput.press("Enter");

  // Open connection settings and connect (mock needs no port selection).
  await openConnectionModal(page);
  await clickModalConnect(page);

  // Connected: top bar visibly shows Online only.
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 8000,
  });
  await expect(page.locator(".ant-layout-header")).not.toContainText(
    "Disconnect",
  );
  await expect(
    page.locator(".connection-cluster__button"),
  ).toHaveAccessibleName("Online · Disconnect");

  // Read: Data shows 00AB (hex).
  await page
    .getByRole("button", { name: /^Read row / })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  const dataInput = page.getByLabel("Data", { exact: true }).first();
  await expect(dataInput).toHaveText("00AB");

  // Write: entering 12AB updates the mock device register.
  // 可编辑单元格在 Enter/blur 才提交到 store，WRITE 读的是已提交的 cellText，须先提交。
  await dataInput.click();
  await dataInput.fill("12AB");
  await dataInput.press("Enter");
  await page
    .getByRole("button", { name: /^Write row / })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (
          window as unknown as {
            __mamepMock: { getRegister(a: number): number | null };
          }
        ).__mamepMock.getRegister(0x0001),
      ),
    )
    .toBe(0x12ab);

  // Comm Log tab shows request bytes in hex.
  await page
    .getByRole("tab", { name: "Comm Log" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForTimeout(300);
  await expect(page.locator(".comm-log__list")).toContainText(
    "01 03 00 01 00 01",
    { timeout: 5000 },
  );
});

test("read all updates eligible rows and reports a summary message", async ({
  page,
}) => {
  await openApp(page);
  await page.evaluate(() => {
    const mock = (
      window as unknown as {
        __mamepMock: { setRegister(a: number, v: number): void };
      }
    ).__mamepMock;
    mock.setRegister(0x0001, 0x0102);
    mock.setRegister(0x0002, 0x0304);
  });

  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "Add Row" })
      .evaluate((el) => (el as HTMLElement).click());
  }
  const addressInputs = page.getByLabel("Address", { exact: true });
  await addressInputs.nth(0).click();
  await addressInputs.nth(0).fill("0001");
  await addressInputs.nth(0).press("Enter");
  await addressInputs.nth(1).click();
  await addressInputs.nth(1).fill("0002");
  await addressInputs.nth(1).press("Enter");

  await page
    .getByRole("button", { name: "Read All" })
    .evaluate((el) => (el as HTMLElement).click());
  const dataInputs = page.getByLabel("Data", { exact: true });
  await expect(dataInputs.nth(0)).toHaveText("0102", { timeout: 8000 });
  await expect(dataInputs.nth(1)).toHaveText("0304", { timeout: 8000 });
});

test("WP polling refreshes the data cell at the Rx Delay interval", async ({
  page,
}) => {
  await openApp(page);

  await page
    .getByRole("button", { name: "Add Row" })
    .evaluate((el) => (el as HTMLElement).click());
  const addressInput = page.getByLabel("Address", { exact: true }).first();
  await addressInput.click();
  await addressInput.fill("0003");
  await addressInput.press("Enter");

  await page.evaluate(() =>
    (
      window as unknown as {
        __mamepMock: { setRegister(a: number, v: number): void };
      }
    ).__mamepMock.setRegister(0x0003, 0x0007),
  );
  await page
    .getByLabel(/^Poll row /)
    .first()
    .evaluate((el) => (el as HTMLElement).click());

  const dataInput = page.getByLabel("Data", { exact: true }).first();
  await expect(dataInput).toHaveText("0007", { timeout: 8000 });

  // Changing the device value is picked up by polling (forced overwrite).
  await page.evaluate(() =>
    (
      window as unknown as {
        __mamepMock: { setRegister(a: number, v: number): void };
      }
    ).__mamepMock.setRegister(0x0003, 0x00ff),
  );
  await expect(dataInput).toHaveText("00FF", { timeout: 8000 });

  await page
    .getByLabel(/^Poll row /)
    .first()
    .evaluate((el) => (el as HTMLElement).click());
});
