import { expect, test, type Locator, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
}

function parentRow(page: Page, index = 0) {
  return page
    .locator(
      ".register-table-tabs .ant-tabs-content-active .ant-table-tbody tr[data-row-key]",
    )
    .nth(index);
}

function bitRows(page: Page) {
  return page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody tr[data-row-key*=':b']",
  );
}

async function setAddress(
  row: ReturnType<typeof parentRow>,
  address: string,
): Promise<void> {
  const input = row.getByLabel("Address", { exact: true });
  await input.click();
  await input.fill(address);
  await input.press("Enter");
}

async function setBinaryType(
  page: Page,
  row: ReturnType<typeof parentRow>,
): Promise<void> {
  await row.getByLabel("Type").click();
  await page.locator(".ant-select-dropdown:visible [title='Binary']").click();
}

async function expectBit(
  row: Locator,
  bit: number,
  value: "1" | "0",
): Promise<void> {
  const toggle = row.getByLabel(`Toggle bit ${bit}`);
  await expect(toggle).toHaveAttribute(
    "aria-checked",
    value === "1" ? "true" : "false",
  );
  await expect(
    toggle.locator(
      value === "1"
        ? ".ant-switch-inner-checked"
        : ".ant-switch-inner-unchecked",
    ),
  ).toHaveText(value);
}

test("bit detail integrates device read, editing and workspace persistence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });

  await openApp(page);
  const first = parentRow(page);
  await setBinaryType(page, first);
  await setAddress(first, "0");
  await page.evaluate(() =>
    (
      window as unknown as {
        __mamepMock: { setRegister(address: number, value: number): void };
      }
    ).__mamepMock.setRegister(0, 0x8001),
  );
  await first.getByRole("button", { name: "Read", exact: true }).click();
  await expect(first.getByLabel("Data")).toHaveText("10000000 00000001", {
    timeout: 8000,
  });

  await first.locator('button[aria-label="Expand row"]').click();
  await expect(bitRows(page)).toHaveCount(16);
  const bit15 = bitRows(page).nth(0);
  await expect(bit15).toContainText("0 Bit 15");
  await expect(bit15.locator("span[title='0x8000']")).toHaveCount(1);
  await expectBit(bit15, 15, "1");
  await expectBit(bitRows(page).nth(15), 0, "1");
  await expect(
    bitRows(page).locator(".register-table__bit-value input"),
  ).toHaveCount(0);

  await bit15.getByLabel("Toggle bit 15").click();
  await expectBit(bitRows(page).nth(0), 15, "0");
  await expect(first.getByLabel("Data")).toHaveText("00000000 00000001");

  const name = bitRows(page).nth(0).getByLabel("Name");
  await name.click();
  await name.fill("Alarm bit");
  await name.press("Enter");
  const comment = bitRows(page).nth(0).getByLabel("Comment");
  await comment.click();
  await comment.fill("alarm");
  await comment.press("Enter");
  await expect(bitRows(page).nth(0).getByLabel("Name")).toHaveText("Alarm bit");
  await expect(bitRows(page).nth(0).getByLabel("Comment")).toHaveText("alarm");

  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  await parentRow(page).locator('button[aria-label="Expand row"]').click();
  await expect(bitRows(page)).toHaveCount(16);
  await expect(bitRows(page).nth(0).getByLabel("Name")).toHaveText("Alarm bit");
  await expect(bitRows(page).nth(0).getByLabel("Comment")).toHaveText("alarm");
  expect(errors).toEqual([]);
});

test("coarse-pointer bit switches do not increase row height", async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1600, height: 900 },
  });
  const page = await context.newPage();
  try {
    await openApp(page);
    const first = parentRow(page);
    await setBinaryType(page, first);
    await setAddress(first, "0");
    await first.locator('button[aria-label="Expand row"]').click();

    const bit15 = bitRows(page).nth(0);
    await expect(bit15).toBeVisible();
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    await expect(bit15.locator("td").first()).toHaveCSS("height", "29px");
    const toggleHeight = await bit15
      .getByLabel("Toggle bit 15")
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(toggleHeight).toBeLessThanOrEqual(24);
  } finally {
    await context.close();
  }
});
