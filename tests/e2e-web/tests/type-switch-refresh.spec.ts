/**
 * Type/Scale 切换即时刷新显示（ADR-053，2026-09-11）E2E：
 * - 读回 HEX `00AB` → 切 Unsigned 显示同一数值 `171`（原始值不变）
 * - 切换后直接 Write：设备收到的仍是原值 0x00AB（不得按新进制重解释为 0x171）
 * - 切 Binary 显示每 8 位分组 + 位明细可展开 16 行（联动 ADR-052）
 * - 范围行：父行组合文本按新 Type 刷新，子行值显示不受影响
 * - 空行切换 Type 保持为空（不生成 0）
 * - 全程无 console 错误
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

function parentRow(page: Page, index: number) {
  return page
    .locator(
      ".register-table-tabs .ant-tabs-content-active .ant-table-tbody tr[data-row-key]",
    )
    .nth(index);
}

function childRows(page: Page) {
  return page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody tr[data-row-key*=':c']:not([data-row-key*=':b'])",
  );
}

function bitRows(page: Page) {
  return page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody tr[data-row-key*=':b']",
  );
}

/** mock 钩子类型（dev-only window.__mamepMock）。 */
interface MamepMockApi {
  setRegister(address: number, value: number): void;
  getRegister(address: number): number | null;
}

async function mockSet(
  page: Page,
  address: number,
  value: number,
): Promise<void> {
  await page.evaluate(
    ({ a, v }) => {
      (
        window as unknown as { __mamepMock: MamepMockApi }
      ).__mamepMock.setRegister(a, v);
    },
    { a: address, v: value },
  );
}

async function mockGet(page: Page, address: number): Promise<number | null> {
  return await page.evaluate(
    (a) =>
      (
        window as unknown as { __mamepMock: MamepMockApi }
      ).__mamepMock.getRegister(a),
    address,
  );
}

/** 把行 Type（进制列）切到指定选项（下拉 option title）。 */
async function setType(
  page: Page,
  target: ReturnType<typeof parentRow>,
  title: string,
): Promise<void> {
  await target.getByLabel("Type").click();
  await page.locator(`.ant-select-dropdown:visible [title='${title}']`).click();
}

/** 填入地址（点击进入编辑态后填写）。 */
async function setAddress(
  target: ReturnType<typeof parentRow>,
  address: string,
): Promise<void> {
  const input = target.getByLabel("Address", { exact: true });
  await input.click();
  await input.fill(address);
  await input.press("Enter");
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  return errors;
}

test("读回后切换 Type 立即刷新显示，且写入仍是原值（ADR-053）", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openApp(page);
  const first = parentRow(page, 0);
  await setAddress(first, "0");
  await mockSet(page, 0, 0x00ab);
  await first.getByRole("button", { name: "Read", exact: true }).click();
  await expect(first.getByLabel("Data")).toHaveText("00AB", {
    timeout: 8000,
  });

  // 切 Unsigned：立即显示同一数值（171），原始值不变。
  await setType(page, first, "Unsigned Dec.");
  await expect(first.getByLabel("Data")).toHaveText("171");

  // 切换后未重新读取直接写：设备收到的仍是 0x00AB（不得按新进制解析为 0x171）。
  await first.getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    first.locator(".register-table__status-dot--success"),
  ).toBeVisible({ timeout: 8000 });
  expect(await mockGet(page, 0)).toBe(0x00ab);

  // 切回 HEX：按原值重新显示。
  await setType(page, first, "HEX");
  await expect(first.getByLabel("Data")).toHaveText("00AB");
  expect(errors).toEqual([]);
});

test("切 Binary：显示每 8 位分组 + 位明细可展开 16 行（联动 ADR-052）", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openApp(page);
  const first = parentRow(page, 0);
  await setAddress(first, "0");
  await mockSet(page, 0, 0x00ab);
  await first.getByRole("button", { name: "Read", exact: true }).click();
  await expect(first.getByLabel("Data")).toHaveText("00AB", {
    timeout: 8000,
  });

  await setType(page, first, "Binary");
  await expect(first.getByLabel("Data")).toHaveText("00000000 10101011");
  await first.locator('button[aria-label="Expand row"]').click();
  await expect(bitRows(page)).toHaveCount(16);
  expect(errors).toEqual([]);
});

test("范围行：父行组合文本按新 Type 刷新，子行显示不受影响", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openApp(page);
  const first = parentRow(page, 0);
  await setAddress(first, "0-1");
  await mockSet(page, 0x0000, 0x1111);
  await mockSet(page, 0x0001, 0x2222);
  await first.getByRole("button", { name: "Read", exact: true }).click();
  await expect(first.getByLabel("Data")).toHaveText("1111 2222", {
    timeout: 8000,
  });
  await first.locator('button[aria-label="Expand row"]').click();
  await expect(childRows(page)).toHaveCount(2);

  // 组合文本按新 Type 刷新（32 位无符号组合值），registerValues 不变。
  await setType(page, first, "Unsigned Dec.");
  await expect(first.getByLabel("Data")).toHaveText("286335522");
  // 子行按各自 Type（范围建立时继承的 hex）显示，不随父行刷新而改变。
  await expect(childRows(page).nth(0).getByLabel("Data")).toHaveText("1111");
  await expect(childRows(page).nth(1).getByLabel("Data")).toHaveText("2222");

  // 切回 HEX：组合文本复原。
  await setType(page, first, "HEX");
  await expect(first.getByLabel("Data")).toHaveText("1111 2222");
  expect(errors).toEqual([]);
});

test("空行切换 Type：保持为空（不生成 0）", async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);
  const second = parentRow(page, 1);
  await setType(page, second, "Unsigned Dec.");
  await expect(second).toContainText("Unsigned Dec.");
  await expect(second.getByLabel("Data")).toHaveText("—");
  expect(errors).toEqual([]);
});
