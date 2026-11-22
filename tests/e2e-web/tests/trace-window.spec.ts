import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
}

function firstRow(page: Page) {
  return page
    .locator(
      ".register-table-tabs .ant-tabs-content-active .ant-table-tbody [data-row-key]",
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

  await firstRow(page).getByLabel(/^Trace row /).click();
  const traceWindow = page.locator(".trace-window");
  await expect(traceWindow).toBeVisible({ timeout: 15_000 });
  await expect(traceWindow).toContainText("M@MEp2006 Advance [Memory Trace]");
  await expect(traceWindow).toContainText("Buffer Size");
  await expect(traceWindow).toContainText("Speed");

  // 打开窗口不应自动采样；只有 Play 才启动追踪。
  await page.waitForTimeout(1500);
  await expect(
    traceWindow.locator(".ant-table-tbody [data-row-key]"),
  ).toHaveCount(0);

  // 窗口打开后主线程仍可执行，而不是停留在冻结的渲染循环中。
  await expect
    .poll(() => page.evaluate(() => document.readyState), { timeout: 5000 })
    .toBe("complete");

  await traceWindow.getByRole("button", { name: "Play" }).click();
  await expect(
    traceWindow.locator(".ant-table-tbody [data-row-key]"),
  ).toHaveCount(2, { timeout: 5000 });
  await expect(traceWindow).toContainText("0010");

  // 窗口打开期间取消 TM 不会关闭追踪窗。
  await firstRow(page).getByLabel(/^Trace row /).click();
  await expect(traceWindow).toBeVisible();
  await expect(firstRow(page).getByLabel(/^Trace row /)).toBeChecked();

  await traceWindow.getByRole("button", { name: "Stop" }).click();
  await expect(traceWindow.getByLabel("Average")).not.toHaveValue("");

  await traceWindow.getByRole("button", { name: "Close" }).click();
  await expect(traceWindow).toBeHidden();
  await expect(firstRow(page).getByLabel(/^Trace row /)).not.toBeChecked();
  expect(errors).toEqual([]);
});
