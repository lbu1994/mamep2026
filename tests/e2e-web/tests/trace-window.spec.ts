import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
}

function firstRow(page: Page) {
  return page
    .locator(
      ".register-table-tabs .ant-tabs-content-active .ant-table-tbody tr[data-row-key]",
    )
    .first();
}

test("TM opens Memory Trace and Play keeps the page responsive", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });

  await openApp(page);
  await page.evaluate(() => {
    (
      window as unknown as {
        __mamepMock: { setRegister(address: number, value: number): void };
      }
    ).__mamepMock.setRegister(1, 0x0010);
  });

  const address = firstRow(page).getByLabel("Address", { exact: true });
  await address.click();
  await address.fill("1");
  await address.press("Enter");

  await firstRow(page).getByLabel("TM").click();
  await expect(page.locator(".trace-window")).toBeVisible({ timeout: 5000 });

  // 窗口打开后主线程仍可执行，而不是停留在冻结的渲染循环中。
  await expect
    .poll(() => page.evaluate(() => document.readyState), { timeout: 5000 })
    .toBe("complete");

  await page
    .locator(".trace-window")
    .getByRole("button", { name: "Play" })
    .click();
  await expect(
    page.locator(".trace-window .ant-table-tbody tr.ant-table-row"),
  ).toHaveCount(2, { timeout: 5000 });

  await page
    .locator(".trace-window")
    .getByRole("button", { name: "Stop" })
    .click();
  await expect(
    page.locator(".trace-window").getByLabel("Average"),
  ).not.toHaveValue("");
  expect(errors).toEqual([]);
});
