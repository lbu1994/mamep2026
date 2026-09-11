/**
 * 多寄存器范围行（ADR-030）E2E：
 * - Type 双列（进制 + scale，scale 仅 unsigned/signed 可用）
 * - 范围地址输入 → antd 树形展开子行（每寄存器一行，只读、不可多选/拖拽）
 * - 范围行多寄存器读（FC03 quantity>1）与写（FC0x10 多值 + 写后回读）
 * - must-multi 区（0x0800）：单读/单写异常 0x02，多读/多写正常
 * - 范围长度 × 类型合法集校验（unsigned 仅 1/2/4）→ 类型列红框 + 读写禁用
 * - 剪贴板范围编解码往返（CSV "start-end"）
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

/** mock 钩子类型（dev-only window.__mamepMock，见 packages/platform-web mock-transport）。 */
interface MamepMockApi {
  setRegister(address: number, value: number): void;
  getRegister(address: number): number | null;
}

/** 通过 mock 钩子预置寄存器值。 */
async function mockSet(page: Page, address: number, value: number): Promise<void> {
  await page.evaluate(
    ({ a, v }) => {
      (window as unknown as { __mamepMock: MamepMockApi }).__mamepMock.setRegister(
        a,
        v,
      );
    },
    { a: address, v: value },
  );
}

/** 拦截 navigator.clipboard（writeText 记录 + readText 返回最近一次写入），
 *  避免 E2E 依赖系统剪贴板权限（与 comm-log.spec 同模式）。 */
async function interceptClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as unknown as { __clipboardWrites: string[] }).__clipboardWrites =
      writes;
    try {
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            writes.push(text);
          },
          readText: async () => writes[writes.length - 1] ?? "",
        },
        configurable: true,
      });
    } catch {
      // 忽略替换失败，测试后续会给出明确失败信息。
    }
  });
}

test("Type/Scale 双列：hex 行 scale 禁用，unsigned 行 scale 可用", async ({
  page,
}) => {
  await openApp(page);
  // 第一行默认 hex：Scale 下拉禁用。
  const first = parentRow(page, 0);
  await expect(first.getByLabel("Type")).toBeVisible();
  await expect(first.getByLabel("Scale")).toBeDisabled();
  // 切到 Unsigned：Scale 可用。
  await first.getByLabel("Type").click();
  await page
    .locator(".ant-select-dropdown:visible [title='Unsigned Dec.']")
    .click();
  await expect(first.getByLabel("Scale")).toBeEnabled();
  // 切到 HEX 恢复。
  await first.getByLabel("Type").click();
  await page.locator(".ant-select-dropdown:visible [title='HEX']").click();
  await expect(first.getByLabel("Scale")).toBeDisabled();
});

test("范围行：输入范围→展开子行→多寄存器读→多值写→写后回读", async ({
  page,
}) => {
  await openApp(page);
  // 用第一行（Normal_01，默认 0x0000）改为范围 "0-1"。
  const first = parentRow(page, 0);
  const address = first.getByLabel("Register");
  await address.click();
  await address.fill("0-1");
  await address.press("Enter");

  // 展开箭头出现；点击展开 → 2 个只读子行（地址 0/1，Data「—」）。
  await expect(
    first.locator('button[aria-label="Expand row"]'),
  ).toBeVisible();
  await first.locator('button[aria-label="Expand row"]').click();
  const childRows = page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody tr[data-row-key*=':c']",
  );
  await expect(childRows).toHaveCount(2);
  await expect(childRows.nth(0)).toContainText("0");
  await expect(childRows.nth(1)).toContainText("1");
  // 子行只读：无 Read/Write 按钮、无拖拽手柄、复选框禁用。
  await expect(childRows.nth(0).getByRole("button", { name: "Read" })).toHaveCount(0);
  await expect(
    childRows.nth(0).locator('[aria-label="Drag to reorder"]'),
  ).toHaveCount(0);
  await expect(
    childRows.nth(0).locator("input[type='checkbox']"),
  ).toBeDisabled();

  // 预置寄存器并多寄存器读：父行 Data 组合值 + 子行各值。
  await mockSet(page, 0x0000, 0x1111);
  await mockSet(page, 0x0001, 0x2222);
  await first.getByRole("button", { name: "Read", exact: true }).click();
  await expect(first.getByLabel("Data")).toHaveText("1111 2222");
  await expect(childRows.nth(0).locator("td").nth(7)).toHaveText("1111");
  await expect(childRows.nth(1).locator("td").nth(7)).toHaveText("2222");

  // 多值写（组合文本）+ 写后回读：写入 mock 寄存器并显示绿点。
  const data = first.getByLabel("Data");
  await data.click();
  await data.fill("AAAA BBBB");
  await data.press("Enter");
  await first.getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    first.locator(".register-table__status-dot--success"),
  ).toBeVisible();
  const written = await page.evaluate(() => ({
    a: (window as unknown as { __mamepMock: MamepMockApi }).__mamepMock.getRegister(
      0x0000,
    ),
    b: (window as unknown as { __mamepMock: MamepMockApi }).__mamepMock.getRegister(
      0x0001,
    ),
  }));
  expect(written).toEqual({ a: 0xaaaa, b: 0xbbbb });
});

test("范围行父行 Data 编辑后子行同步（2026-09-11 bug 修复）", async ({ page }) => {
  await openApp(page);
  const first = parentRow(page, 0);
  const address = first.getByLabel("Register");
  await address.click();
  await address.fill("0-1");
  await address.press("Enter");

  // 先读取（registerValues 非空：1111 / 2222）并展开子行。
  await mockSet(page, 0x0000, 0x1111);
  await mockSet(page, 0x0001, 0x2222);
  await first.getByRole("button", { name: "Read", exact: true }).click();
  await expect(first.getByLabel("Data")).toHaveText("1111 2222");
  await first.locator('button[aria-label="Expand row"]').click();
  const childRows = page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody tr[data-row-key*=':c']",
  );
  await expect(childRows).toHaveCount(2);
  await expect(childRows.nth(0).locator("td").nth(7)).toHaveText("1111");
  await expect(childRows.nth(1).locator("td").nth(7)).toHaveText("2222");

  // 仅手工编辑父行组合文本（不读不写）：子行须随父行文本更新（修复前仍显示旧读值）。
  const data = first.getByLabel("Data");
  await data.click();
  await data.fill("FFFF 0000");
  await data.press("Enter");
  await expect(childRows.nth(0).locator("td").nth(7)).toHaveText("FFFF");
  await expect(childRows.nth(1).locator("td").nth(7)).toHaveText("0000");

  // 改后写入的是父行文本解析值（FFFF / 0000），证明原始值同步未影响待写值语义。
  await first.getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    first.locator(".register-table__status-dot--success"),
  ).toBeVisible();
  const written = await page.evaluate(() => ({
    a: (
      window as unknown as { __mamepMock: MamepMockApi }
    ).__mamepMock.getRegister(0x0000),
    b: (
      window as unknown as { __mamepMock: MamepMockApi }
    ).__mamepMock.getRegister(0x0001),
  }));
  expect(written).toEqual({ a: 0xffff, b: 0x0000 });
});

test("范围行子行可编辑化：Name/Data/Type/Scale/Comment 编辑 + 重启恢复（2026-08-27）", async ({
  page,
}) => {
  await openApp(page);
  const first = parentRow(page, 0);
  // 首行改为范围 "0-1" 并展开。
  const address = first.getByLabel("Register");
  await address.click();
  await address.fill("0-1");
  await address.press("Enter");
  await expect(first.locator('button[aria-label="Expand row"]')).toBeVisible();
  await first.locator('button[aria-label="Expand row"]').click();
  const childRows = page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody tr[data-row-key*=':c']",
  );
  await expect(childRows).toHaveCount(2);

  // 子行 Name/Data/Type/Scale/Comment 可编辑（其余列维持不可用：无 Read/Write、无拖拽、复选框禁用）。
  const child0 = childRows.nth(0);
  const child1 = childRows.nth(1);
  await expect(child0.getByRole("button", { name: "Read" })).toHaveCount(0);
  await expect(child0.locator("input[type='checkbox']")).toBeDisabled();

  // 子行 0 Name / Data / Comment。
  const name0 = child0.getByLabel("Name");
  await name0.click();
  await name0.fill("ChildA");
  await name0.press("Enter");
  const data0 = child0.getByLabel("Data");
  await data0.click();
  await data0.fill("00AB");
  await data0.press("Enter");
  const comment0 = child0.getByLabel("Comment");
  await comment0.click();
  await comment0.fill("First");
  await comment0.press("Enter");
  // 子行 Data 编辑同步父行组合文本（子行 1 未读 → 0）。
  await expect(first.getByLabel("Data")).toHaveText("00AB 0000");

  // 子行 1 Type 切到 Unsigned（Scale 随之可用）+ Data "300"。
  const type1 = child1.getByLabel("Type");
  await type1.click();
  await page
    .locator(".ant-select-dropdown:visible [title='Unsigned Dec.']")
    .click();
  await expect(child1.getByLabel("Scale")).toBeEnabled();
  const data1 = child1.getByLabel("Data");
  await data1.click();
  await data1.fill("300");
  await data1.press("Enter");
  await expect(first.getByLabel("Data")).toHaveText("00AB 012C");

  // 重启恢复（IndexedDB 自动保存）：先等自动保存落盘，再 reload；展开后子行元数据与值全部还原。
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText(
    "Disconnect",
    { timeout: 15000 },
  );
  const restoredParent = parentRow(page, 0);
  await expect(
    restoredParent.locator('button[aria-label="Expand row"]'),
  ).toBeVisible();
  await restoredParent.locator('button[aria-label="Expand row"]').click();
  const restoredChildren = page.locator(
    ".register-table-tabs .ant-tabs-content-active .ant-table-tbody tr[data-row-key*=':c']",
  );
  await expect(restoredChildren).toHaveCount(2);
  await expect(restoredChildren.nth(0).getByLabel("Name")).toHaveText(
    "ChildA",
  );
  await expect(restoredChildren.nth(0).getByLabel("Data")).toHaveText("00AB");
  await expect(restoredChildren.nth(0).getByLabel("Comment")).toHaveText(
    "First",
  );
  await expect(restoredChildren.nth(1).getByLabel("Data")).toHaveText("300");
  // 子行 1 Type 已还原为 Unsigned（Scale 下拉仅 unsigned/signed 时可用；且 Data 显示 "300"
  // 而非 hex 的 "012C"，本身即证明 unsigned 类型随工作区持久化）。
  await expect(restoredChildren.nth(1).getByLabel("Scale")).toBeEnabled();
});

test("must-multi 区：单读/单写异常，多读/多写正常", async ({ page }) => {
  await openApp(page);
  // 默认预填 MustMulti_01 在 0x0800（单行）。单读 → 异常红点。
  const mustRow = page.locator("tr.ant-table-row", {
    hasText: "MustMulti_01",
  });
  await mockSet(page, 0x0800, 0x1234);
  await mustRow.getByRole("button", { name: "Read", exact: true }).click();
  await expect(
    mustRow.locator(".register-table__status-dot--error"),
  ).toBeVisible();
  await expect(
    mustRow.locator(".register-table__status-dot--success"),
  ).toHaveCount(0);

  // 把 MustMulti_01 改为范围 "2048-2049"（0x0800-0x0801）→ 多读正常。
  const address = mustRow.getByLabel("Register");
  await address.click();
  await address.fill("2048-2049");
  await address.press("Enter");
  await expect(
    mustRow.locator('button[aria-label="Expand row"]'),
  ).toBeVisible();
  await mockSet(page, 0x0801, 0x5678);
  await mustRow.getByRole("button", { name: "Read", exact: true }).click();
  await expect(mustRow.getByLabel("Data")).toHaveText("1234 5678");
  await expect(
    mustRow.locator(".register-table__status-dot--success"),
  ).toBeVisible();

  // 多值写 + 写后回读 → 正常（写入 mock 寄存器）。
  const data = mustRow.getByLabel("Data");
  await data.click();
  await data.fill("CAFE BEEF");
  await data.press("Enter");
  await mustRow.getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    mustRow.locator(".register-table__status-dot--success"),
  ).toBeVisible();
  const written = await page.evaluate(() => ({
    a: (window as unknown as { __mamepMock: MamepMockApi }).__mamepMock.getRegister(
      0x0800,
    ),
    b: (window as unknown as { __mamepMock: MamepMockApi }).__mamepMock.getRegister(
      0x0801,
    ),
  }));
  expect(written).toEqual({ a: 0xcafe, b: 0xbeef });
});

test("范围长度 × 类型合法集校验：unsigned 非法数量在类型列报错并禁用读写", async ({
  page,
}) => {
  await openApp(page);
  const first = parentRow(page, 0);
  // 范围 "0-2"（3 寄存器）+ unsigned（仅 1/2/4 合法）→ 类型列红框 + Read/Write 禁用。
  const address = first.getByLabel("Register");
  await address.click();
  await address.fill("0-2");
  await address.press("Enter");
  await first.getByLabel("Type").click();
  await page
    .locator(".ant-select-dropdown:visible [title='Unsigned Dec.']")
    .click();
  await expect(
    first.locator(".ant-select-status-error"),
  ).toBeVisible();
  await expect(
    first.getByRole("button", { name: "Read", exact: true }),
  ).toBeDisabled();
  await expect(
    first.getByRole("button", { name: "Write", exact: true }),
  ).toBeDisabled();

  // 改回合法数量（2 寄存器）：错误消失，读写恢复。
  const address2 = first.getByLabel("Register");
  await address2.click();
  await address2.fill("0-1");
  await address2.press("Enter");
  await expect(first.locator(".ant-select-status-error")).toHaveCount(0);
  await expect(
    first.getByRole("button", { name: "Read", exact: true }),
  ).toBeEnabled();
});

test("剪贴板范围编解码往返：复制范围行粘贴恢复 registerCount", async ({
  page,
}) => {
  await interceptClipboard(page);
  await openApp(page);
  // 第一行改为范围 "0-1"，然后复制 → 粘贴到末尾 → 新行仍是范围行（可展开）。
  const first = parentRow(page, 0);
  const address = first.getByLabel("Register");
  await address.click();
  await address.fill("0-1");
  await address.press("Enter");

  // 选择第一行并 Ctrl+C。
  await first
    .locator("td.ant-table-selection-column .ant-checkbox-input")
    .check();
  await page.keyboard.press("Control+c");

  // 拦截的剪贴板写入应含 CSV 范围 "0-1"。
  const writes = await page.evaluate(
    () => (window as unknown as { __clipboardWrites: string[] }).__clipboardWrites,
  );
  expect(writes[0]).toContain("0-1");

  // 粘贴（锚定选中行之后）：新行（第 2 行）带范围 → 展开箭头出现。
  await page.keyboard.press("Control+v");
  const pasted = parentRow(page, 1);
  await expect(pasted.locator('button[aria-label="Expand row"]')).toBeVisible();
  await expect(pasted.getByLabel("Register")).toHaveText(/^\d+-\d+$/);
});
