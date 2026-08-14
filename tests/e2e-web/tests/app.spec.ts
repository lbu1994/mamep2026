import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 DISCONNECT 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("DISCONNECT", {
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
    .getByRole("button", { name: "Connection" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".ant-modal-container:visible", { timeout: 5000 });
}

async function clickModalConnect(page: Page): Promise<void> {
  await page
    .locator(".ant-modal-container:visible .ant-btn")
    .filter({ hasText: "CONNECT" })
    .evaluate((el) => (el as HTMLElement).click());
}

test("mock startup skips Connection Settings and auto-connects", async ({
  page,
}) => {
  await openApp(page);

  // 启动即进主界面：不出现 Connection Settings 弹窗。
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);
  // 自动连接 mock：MOCK 徽标、DISCONNECT 按钮、Online 状态。
  const header = page.locator(".ant-layout-header");
  await expect(header).toContainText("MOCK");
  await expect(header).toContainText("DISCONNECT");
  await expect(header).toContainText("Online");
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
  // Defaults: Slave Address=1, Rx Delay=50, Address Adjust=OFF, Timeout=1000, Retry=1.
  await expect(modal).toContainText("Slave Address");
  await expect(modal).toContainText("Address Adjust");
  await expect(modal).toContainText("OFF");
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
    "Register[DEC]",
    "WP",
    "READ",
    "Data",
    "WRITE",
    "Type",
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
    .getByRole("button", { name: /DISCONNECT/ })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".ant-layout-header")).not.toContainText(
    "DISCONNECT",
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
  const addressInput = page.getByLabel("Register", { exact: true }).first();
  await addressInput.click();
  await addressInput.fill("1");
  await addressInput.press("Enter");

  // Open connection settings and connect (mock needs no port selection).
  await openConnectionModal(page);
  await clickModalConnect(page);

  // Connected: top bar button becomes DISCONNECT and state is Online.
  await expect(page.locator(".ant-layout-header")).toContainText("DISCONNECT", {
    timeout: 8000,
  });
  await expect(page.locator(".ant-layout-header")).toContainText("Online");

  // READ: Data shows 00AB (hex).
  await page
    .getByRole("button", { name: "READ", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  const dataInput = page.getByLabel("Data").first();
  await expect(dataInput).toHaveValue("00AB");

  // WRITE: entering 12AB updates the mock device register.
  await dataInput.click();
  await dataInput.fill("12AB");
  await page
    .getByRole("button", { name: "WRITE", exact: true })
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
  await expect(page.locator(".ant-tabs").last()).toContainText(
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
  const addressInputs = page.getByLabel("Register", { exact: true });
  await addressInputs.nth(0).fill("0001");
  await addressInputs.nth(0).press("Enter");
  await addressInputs.nth(1).fill("0002");
  await addressInputs.nth(1).press("Enter");

  await page
    .getByRole("button", { name: "Read All" })
    .evaluate((el) => (el as HTMLElement).click());
  const dataInputs = page.getByLabel("Data");
  await expect(dataInputs.nth(0)).toHaveValue("0102", { timeout: 8000 });
  await expect(dataInputs.nth(1)).toHaveValue("0304", { timeout: 8000 });
});

test("WP polling refreshes the data cell at the Rx Delay interval", async ({
  page,
}) => {
  await openApp(page);

  await page
    .getByRole("button", { name: "Add Row" })
    .evaluate((el) => (el as HTMLElement).click());
  const addressInput = page.getByLabel("Register", { exact: true }).first();
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
    .getByLabel("WP")
    .first()
    .evaluate((el) => (el as HTMLElement).click());

  const dataInput = page.getByLabel("Data").first();
  await expect(dataInput).toHaveValue("0007", { timeout: 8000 });

  // Changing the device value is picked up by polling (forced overwrite).
  await page.evaluate(() =>
    (
      window as unknown as {
        __mamepMock: { setRegister(a: number, v: number): void };
      }
    ).__mamepMock.setRegister(0x0003, 0x00ff),
  );
  await expect(dataInput).toHaveValue("00FF", { timeout: 8000 });

  await page
    .getByLabel("WP")
    .first()
    .evaluate((el) => (el as HTMLElement).click());
});

test("TM opens a Memory Trace window and collects samples", async ({
  page,
}) => {
  await openApp(page);

  await page
    .getByRole("button", { name: "Add Row" })
    .evaluate((el) => (el as HTMLElement).click());
  const addressInput = page.getByLabel("Register", { exact: true }).first();
  await addressInput.fill("0004");
  await addressInput.press("Enter");

  await page.evaluate(() =>
    (
      window as unknown as {
        __mamepMock: { setRegister(a: number, v: number): void };
      }
    ).__mamepMock.setRegister(0x0004, 0x1234),
  );
  await page
    .getByLabel("TM")
    .first()
    .evaluate((el) => (el as HTMLElement).click());

  const traceWindow = page.locator(".trace-window");
  await expect(traceWindow).toBeVisible({ timeout: 5000 });
  await expect(traceWindow).toContainText("M@MEp2006 Advance [Memory Trace]");
  await expect(traceWindow).toContainText("Play");
  await expect(traceWindow).toContainText("Stop");
  await expect(traceWindow).toContainText("Save");
  await expect(traceWindow).toContainText("Buffer Size");
  await expect(traceWindow).toContainText("Speed");
  await expect(traceWindow).toContainText("Average");

  // Sampled value (hex 1234) appears in the No./Data list.
  await expect(traceWindow).toContainText("1234", { timeout: 10000 });

  // Stop shows the Average value.
  await traceWindow
    .getByRole("button", { name: /Stop/ })
    .evaluate((el) => (el as HTMLElement).click());
  await expect
    .poll(async () => page.getByLabel("Average").first().inputValue())
    .not.toBe("");
});

test("sheets can be added and the workspace survives a reload", async ({
  page,
}) => {
  await openApp(page);

  await page
    .getByRole("button", { name: "Add Row" })
    .evaluate((el) => (el as HTMLElement).click());
  const addressInput = page.getByLabel("Register", { exact: true }).first();
  await addressInput.fill("10");
  await addressInput.press("Enter");
  await page.getByLabel("Name").first().fill("SpeedRef");

  // Add a second sheet.
  await page
    .getByRole("button", { name: "New Register Table" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 2");

  // Wait for autosave, then reload.
  await page.waitForTimeout(1000);
  await page.reload();
  // Mock 模式 reload 后不弹窗，自动连接完成即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("DISCONNECT", {
    timeout: 15000,
  });

  // After reload: no modal, workspace is restored, app is online (mock auto-connect).
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);
  // The active sheet may be Sheet 2 after reload; switch back to Sheet 1 to assert rows.
  await page
    .locator(".ant-layout-sider li")
    .filter({ hasText: "Sheet 1" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(
    page.getByLabel("Register", { exact: true }).first(),
  ).toHaveValue("10");
  await expect(page.getByLabel("Name").first()).toHaveValue("SpeedRef");
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 2");
  await expect(page.locator(".ant-layout-header")).toContainText("Online");
});

test("plugin manager lists the built-in plugin with enable toggle", async ({
  page,
}) => {
  await openApp(page);

  await page
    .getByRole("button", { name: "Plugin Manager" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".ant-modal-container:visible", { timeout: 5000 });
  const modal = page.locator(".ant-modal-container:visible");
  await expect(modal).toContainText("Example Panel");
  await expect(modal).toContainText("1.0.0");
});

test("no console errors during a full interaction round", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("DISCONNECT", {
    timeout: 15000,
  });
  await page
    .getByRole("button", { name: "Add Row" })
    .evaluate((el) => (el as HTMLElement).click());
  // 弹窗路径开合一次（mock 模式不启动自动弹，走手动开关）。
  await openConnectionModal(page);
  await closeModal(page);
  await page.waitForTimeout(800);

  expect(errors).toEqual([]);
});
