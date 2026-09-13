/**
 * Binary 每 8 位分组显示 + 提交规范化（ADR-051）E2E：
 * - 读回后按 8 位分组显示（16 位 = 2 组）
 * - 编辑提交：带空格 / 不带空格均可解析，提交后规范化为分组形式；非法输入保留原文并红框
 * - 范围行（2 寄存器）：父行 4 组、子行各 2 组
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
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody tr[data-row-key*=':c']",
  );
}

/** mock 钩子类型（dev-only window.__mamepMock）。 */
interface MamepMockApi {
  setRegister(address: number, value: number): void;
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

/**
 * 把行 Type（进制列）切到 Binary。
 *
 * 必须**等切换真正落到行上**再返回：高负载下（全量套件串行跑时）antd Select 的选项点击可能丢失，
 * 随后立刻填范围会让子行继承旧类型（HEX）——2026-09-13 全量套件实测到该偶发失败
 * （父行显示 `1111 2222` 而非二进制分组），单跑该 spec 复现不到。
 *
 * 确认用「行内**可见**的 Binary 文本」：表格里存在隐藏的克隆/测量节点，故必须带 `:visible`
 * （否则会命中隐藏元素而误判）。首轮未确认到则关掉下拉重试一次。
 */
async function setBinaryType(
  page: Page,
  target: ReturnType<typeof parentRow>,
): Promise<void> {
  const marker = target.locator(":text-is('Binary'):visible").first();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await target.getByLabel("Type").click();
    await page.locator(".ant-select-dropdown:visible [title='Binary']").click();
    try {
      await expect(marker).toBeVisible({ timeout: 1500 });
      return;
    } catch {
      // 选项点击丢失：关掉下拉，重试一次。
      await page.keyboard.press("Escape");
    }
  }
  await expect(marker).toBeVisible({ timeout: 5000 });
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

test("读回后二进制值每 8 位分组显示", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });

  await openApp(page);
  const first = parentRow(page, 0);
  await setBinaryType(page, first);
  await setAddress(first, "0");
  await mockSet(page, 0, 0x1111);
  await first.getByRole("button", { name: "Read", exact: true }).click();
  await expect(first.getByLabel("Data")).toHaveText("00010001 00010001", {
    timeout: 8000,
  });
  expect(errors).toEqual([]);
});

test("编辑提交：带空格 / 不带空格均可解析，提交后规范化为分组形式", async ({
  page,
}) => {
  await openApp(page);
  const first = parentRow(page, 0);
  await setBinaryType(page, first);
  const data = first.getByLabel("Data");

  // 不带空格：提交后补足 16 位并分组。
  await data.click();
  await data.fill("101");
  await data.press("Enter");
  await expect(data).toHaveText("00000000 00000101");

  // 带空格（分组形式）：原样解析并规范化。
  await data.click();
  await data.fill("11111111 11111111");
  await data.press("Enter");
  await expect(data).toHaveText("11111111 11111111");

  // 非法字符：保留用户输入（§23）+ 红框（不静默改写）。
  await data.click();
  await data.fill("10 2");
  await data.press("Enter");
  await expect(data).toHaveText("10 2");
  await expect(
    first.locator(".register-table__editable-cell-value-wrap--error"),
  ).toBeVisible();
});

test("范围行二进制：父行 4 组、子行各 2 组", async ({ page }) => {
  await openApp(page);
  const first = parentRow(page, 0);
  // 先切 Type 再填范围：子行元数据在范围创建时继承父行 Type（ADR-031，独立后不随父行变化）。
  await setBinaryType(page, first);
  await setAddress(first, "0-1");
  await mockSet(page, 0, 0x1111);
  await mockSet(page, 1, 0x2222);
  await first.getByRole("button", { name: "Read", exact: true }).click();
  await expect(first.getByLabel("Data")).toHaveText(
    "00010001 00010001 00100010 00100010",
    { timeout: 8000 },
  );

  await first.locator('button[aria-label="Expand row"]').click();
  await expect(childRows(page)).toHaveCount(2);
  await expect(childRows(page).nth(0).getByLabel("Data")).toHaveText(
    "00010001 00010001",
  );
  await expect(childRows(page).nth(1).getByLabel("Data")).toHaveText(
    "00100010 00100010",
  );
});
