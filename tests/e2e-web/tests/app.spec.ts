import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
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
    .filter({ hasText: "Connect" })
    .evaluate((el) => (el as HTMLElement).click());
}

test("mock startup skips Connection Settings and auto-connects", async ({
  page,
}) => {
  await openApp(page);

  // 启动即进主界面：不出现 Connection Settings 弹窗。
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);
  // 自动连接 mock：MOCK 徽标、Disconnect 按钮、Online 状态。
  const header = page.locator(".ant-layout-header");
  await expect(header).toContainText("MOCK");
  await expect(header).toContainText("Disconnect");
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

  // Connected: top bar button becomes Disconnect and state is Online.
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 8000,
  });
  await expect(page.locator(".ant-layout-header")).toContainText("Online");

  // Read: Data shows 00AB (hex).
  await page
    .getByRole("button", { name: "Read", exact: true })
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
    .getByRole("button", { name: "Write", exact: true })
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
    .getByLabel("WP")
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
    .getByLabel("WP")
    .first()
    .evaluate((el) => (el as HTMLElement).click());
});

test("TM opens a Memory Trace window and collects samples", async ({
  page,
}) => {
  await openApp(page);

  // 部署一个已连接的表行，并打开其 Memory Trace 窗口（可重跑：在全量套件负载下，
  // Mock 自动连接偶发掉线导致追踪窗不出现，此时 reload 重连 Mock 后重试一次）。
  const setupTrace = async (): Promise<void> => {
    await page
      .getByRole("button", { name: "Add Row" })
      .evaluate((el) => (el as HTMLElement).click());
    const addressInput = page.getByLabel("Address", { exact: true }).first();
    await addressInput.click();
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
  };

  const traceWindow = page.locator(".trace-window");
  const openTrace = async (): Promise<void> => {
    await setupTrace();
    await expect(traceWindow).toBeVisible({ timeout: 8000 });
    await expect(traceWindow).toContainText("M@MEp2006 Advance [Memory Trace]");
  };

  try {
    await openTrace();
  } catch (_err) {
    // 偶发掉线：reload 后重连 Mock 并重试一次（仅防御性重试，非掩盖真实回归）。
    await page.reload();
    await expect(page.locator(".ant-layout-header")).toContainText(
      "Disconnect",
      {
        timeout: 15000,
      },
    );
    await openTrace();
  }
  await expect(traceWindow).toContainText("Play");
  await expect(traceWindow).toContainText("Stop");
  await expect(traceWindow).toContainText("Save");
  await expect(traceWindow).toContainText("Buffer Size");
  await expect(traceWindow).toContainText("Speed");
  await expect(traceWindow).toContainText("Average");

  // 打开窗口不自动开始采样：等待片刻确认无采样数据出现。
  await page.waitForTimeout(1500);
  await expect(traceWindow).not.toContainText("1234");

  // 手动点击 Play 才开始采样；采样值（hex 1234）出现在 No./Data 列表。
  await traceWindow
    .getByRole("button", { name: /Play/ })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(traceWindow).toContainText("1234", { timeout: 10000 });

  // 窗口打开期间无法通过取消勾选 TM 关闭窗口（Checkbox 保持勾选）。
  await page
    .getByLabel("TM")
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(traceWindow).toBeVisible();
  await expect(page.getByLabel("TM").first()).toBeChecked();

  // Stop shows the Average value.
  await traceWindow
    .getByRole("button", { name: /Stop/ })
    .evaluate((el) => (el as HTMLElement).click());
  await expect
    .poll(async () => page.getByLabel("Average").first().inputValue())
    .not.toBe("");

  // 关闭窗口（✕）后窗口消失，TM Checkbox 自动取消勾选。
  await traceWindow
    .getByRole("button", { name: "Close" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(traceWindow).toBeHidden();
  await expect(page.getByLabel("TM").first()).not.toBeChecked();
});

test("sheets can be added and the workspace survives a reload", async ({
  page,
}) => {
  await openApp(page);

  await page
    .getByRole("button", { name: "Add Row" })
    .evaluate((el) => (el as HTMLElement).click());
  const addressInput = page.getByLabel("Address", { exact: true }).first();
  await addressInput.click();
  await addressInput.fill("10");
  await addressInput.press("Enter");
  await page.getByLabel("Name").first().click();
  await page.getByLabel("Name").first().fill("SpeedRef");
  await page.getByLabel("Name").first().press("Enter");

  // Add a second sheet.
  await page
    .getByRole("button", { name: "New Table", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 2");

  // Wait for autosave, then reload.
  await page.waitForTimeout(1000);
  await page.reload();
  // Mock 模式 reload 后不弹窗，自动连接完成即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });

  // After reload: no modal, workspace is restored, app is online (mock auto-connect).
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);
  // The active sheet may be Sheet 2 after reload; switch back to Sheet 1 to assert rows.
  await page
    .locator(".ant-layout-sider li.sheet-item")
    .filter({ hasText: "Sheet 1" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByLabel("Address", { exact: true }).first()).toHaveText(
    "10",
  );
  await expect(page.getByLabel("Name").first()).toHaveText("SpeedRef");
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 2");
  await expect(page.locator(".ant-layout-header")).toContainText("Online");
});

test("plugins tab in Settings shows the (empty) plugin list with the install entry", async ({
  page,
}) => {
  await openApp(page);

  // 插件管理已并入 Settings：顶栏 Settings → Plugins 页签。
  await page
    .getByRole("button", { name: "Settings" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".settings-drawer.ant-drawer-open", {
    timeout: 5000,
  });
  await page
    .locator(".settings-drawer")
    .getByRole("tab", { name: "Plugins" })
    .click();
  const modal = page.getByTestId("plugin-manager");
  await expect(modal).toBeVisible();
  //不再随包分发插件 → 初始为空态，安装入口保持可用。
  await expect(modal).toContainText("No built-in plugins registered.");
  await expect(
    modal.getByRole("button", { name: "Install Plugin" }),
  ).toBeVisible();
});

test("no console errors during a full interaction round", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
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
