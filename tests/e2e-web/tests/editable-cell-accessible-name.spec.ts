import { expect, test, type Locator, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15_000,
  });
  await expect(page.locator('[data-startup-hydrated="true"]')).toHaveCount(1);
}

function dataRows(page: Page): Locator {
  return page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody [data-row-key]",
  );
}

async function setAddress(row: Locator, address: string): Promise<void> {
  const cell = row.locator('[data-register-cell="address"]');
  await cell.click();
  await cell.fill(address);
  await cell.press("Enter");
}

test("editable cell names localize immediately and distinguish rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openApp(page);

  const rows = dataRows(page);
  const first = rows.nth(0);
  const second = rows.nth(1);
  await setAddress(first, "1000");
  await setAddress(second, "1001");

  const enFirstData = first.locator('[data-register-cell="data"]');
  const enSecondData = second.locator('[data-register-cell="data"]');
  await expect(enFirstData).toHaveAttribute(
    "aria-label",
    "Data, row 1, address 1000, table type HOLDING REGISTERS (R/W)",
  );
  await expect(enSecondData).toHaveAttribute(
    "aria-label",
    "Data, row 2, address 1001, table type HOLDING REGISTERS (R/W)",
  );
  await expect(first.locator('[data-register-cell="name"]')).toHaveAttribute(
    "aria-label",
    "Name, row 1, address 1000, table type HOLDING REGISTERS (R/W)",
  );
  await expect(first.locator('[data-register-cell="comment"]')).toHaveAttribute(
    "aria-label",
    "Comment, row 1, address 1000, table type HOLDING REGISTERS (R/W)",
  );
  await expect(first.locator('[data-register-cell="address"]')).toHaveAttribute(
    "aria-label",
    "Address[DEC], row 1, address 1000, table type HOLDING REGISTERS (R/W)",
  );

  await page
    .getByRole("button", { name: "Settings", exact: true })
    .evaluate((element) => (element as HTMLElement).click());
  const language = page.getByTestId("settings-language-select");
  await expect(language).toBeVisible();
  await language.click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: "中文" })
    .first()
    .click();
  await page.locator(".settings-drawer .ant-drawer-close").first().click();
  await expect(
    page.locator(".settings-drawer .ant-drawer-content-wrapper"),
  ).toBeHidden();

  await expect(first.locator('[data-register-cell="data"]')).toHaveAttribute(
    "aria-label",
    "数据，第 1 行，地址 1000，表类型：多个保持寄存器（读/写）",
  );
  await expect(second.locator('[data-register-cell="data"]')).toHaveAttribute(
    "aria-label",
    "数据，第 2 行，地址 1001，表类型：多个保持寄存器（读/写）",
  );
  await expect(first.locator('[data-register-cell="name"]')).toHaveAttribute(
    "aria-label",
    "名称，第 1 行，地址 1000，表类型：多个保持寄存器（读/写）",
  );
  await expect(first.locator('[data-register-cell="comment"]')).toHaveAttribute(
    "aria-label",
    "备注，第 1 行，地址 1000，表类型：多个保持寄存器（读/写）",
  );
  await expect(first.locator('[data-register-cell="address"]')).toHaveAttribute(
    "aria-label",
    "地址[DEC]，第 1 行，地址 1000，表类型：多个保持寄存器（读/写）",
  );

  await first.locator('[data-register-cell="name"]').click();
  await expect(
    first.locator('input[data-register-cell="name"]'),
  ).toHaveAttribute(
    "aria-label",
    "名称，第 1 行，地址 1000，表类型：多个保持寄存器（读/写）",
  );
});
