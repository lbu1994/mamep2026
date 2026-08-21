import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
}

/**
 * 写入结果状态点（回归保护，docs/AGENTS.md §18）：
 * - 设备返回 Modbus 异常响应（写入失败）→ Data 列红点 + Tooltip 原因，绝不显示绿点；
 * - 正常写入成功 → 绿点（aria-label Write successful）。
 * mock 设备只读区（0x0100，默认预填 ReadOnly_01）对写入返回异常 0x02。
 */
test("write failure shows a red status dot with tooltip; success keeps the green dot", async ({
  page,
}) => {
  await openApp(page);

  // 只读区：写入返回异常 0x02（非法数据地址）→ 红点 + Tooltip 原因。
  // 预填行 Data 为空，先填值并提交（Enter 后 WRITE 才读到已提交的 cellText），再写入。
  const readOnlyRow = page.locator("tr.ant-table-row", {
    hasText: "ReadOnly_01",
  });
  const roData = readOnlyRow.getByLabel("Data");
  await roData.click();
  await roData.fill("0001");
  await roData.press("Enter");
  await readOnlyRow.getByRole("button", { name: "Write", exact: true }).click();

  await expect(
    readOnlyRow.locator(".register-table__status-dot--error"),
  ).toBeVisible();
  await expect(
    readOnlyRow.locator(".register-table__status-dot--success"),
  ).toHaveCount(0);
  await expect(
    readOnlyRow.locator(".register-table__status-dot"),
  ).toHaveAttribute("aria-label", "The device returned a Modbus exception.");

  // Tooltip 悬停显示失败原因。
  await readOnlyRow.locator(".register-table__status-dot").hover();
  await expect(page.locator(".ant-tooltip:visible")).toContainText(
    "The device returned a Modbus exception.",
  );

  // 回归：正常区写入成功 → 绿点，且不出现红点。
  const normalRow = page.locator("tr.ant-table-row", {
    hasText: "Normal_01",
  });
  const nData = normalRow.getByLabel("Data");
  await nData.click();
  await nData.fill("0001");
  await nData.press("Enter");
  await normalRow.getByRole("button", { name: "Write", exact: true }).click();

  await expect(
    normalRow.locator(".register-table__status-dot--success"),
  ).toBeVisible();
  await expect(
    normalRow.locator(".register-table__status-dot--error"),
  ).toHaveCount(0);
  await expect(
    normalRow.locator(".register-table__status-dot"),
  ).toHaveAttribute("aria-label", "Write successful");
});
