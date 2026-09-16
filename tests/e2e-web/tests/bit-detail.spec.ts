/**
 * 寄存器位明细展开（ADR-052，2026-09-11）E2E：
 * - 单寄存器 binary 行展开为 16 行位明细（bit15 → bit0）：Address 列「寄存器地址 + Bit 序号」、
 *   位掩码 hover 提示、位值开关（`1`/`0`）、位名称（Name 列，可编辑）、位注释（Comment 列，可编辑）；
 * - 位行 Data 只有开关、**没有输入框**（2026-09-16 交互简化）；未读取时开关内显示 `—` 代替 `0`；
 * - 点击开关改位值 → 父行 Data 立即更新（只改当前值，不写设备）；
 * - 范围行寄存器子行可再展开位明细（两层嵌套）；
 * - 位名称/位注释编辑后随工作区持久化（reload 恢复）；
 * - 全程无 console 错误。
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

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

/** 把行 Type（进制列）切到 Binary。 */
async function setBinaryType(
  page: Page,
  target: ReturnType<typeof parentRow>,
): Promise<void> {
  await target.getByLabel("Type").click();
  await page.locator(".ant-select-dropdown:visible [title='Binary']").click();
}

/**
 * 断言位行开关状态与当前显示的文字。
 * antd Switch 的 `1`/`0` 是两个**恒在 DOM 的兄弟 span**（靠 CSS 滑动切换），所以：
 * 状态一律看 `aria-checked`，显示文字看「当前该显示哪一侧」的 span（未读取时未选中侧为 `—`）。
 */
async function expectBit(
  row: Locator,
  bit: number,
  label: "1" | "0" | "—",
): Promise<void> {
  const toggle = row.getByLabel(`Toggle bit ${bit}`);
  await expect(toggle).toHaveAttribute(
    "aria-checked",
    label === "1" ? "true" : "false",
  );
  await expect(
    toggle.locator(
      label === "1"
        ? ".ant-switch-inner-checked"
        : ".ant-switch-inner-unchecked",
    ),
  ).toHaveText(label);
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

test("单寄存器 binary 行展开为 16 行位明细（bit15 → bit0）", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });

  await openApp(page);
  const first = parentRow(page, 0);
  await setBinaryType(page, first);
  await setAddress(first, "0");
  await mockSet(page, 0, 0x8001);
  await first.getByRole("button", { name: "Read", exact: true }).click();
  await expect(first.getByLabel("Data")).toHaveText("10000000 00000001", {
    timeout: 8000,
  });

  await first.locator('button[aria-label="Expand row"]').click();
  await expect(bitRows(page)).toHaveCount(16);

  // 位号 + 寄存器地址（Address 列 = 地址 + Bit 序号；掩码作为 hover 提示）。
  const bit15 = bitRows(page).nth(0);
  await expect(bit15).toContainText("0 Bit 15");
  await expect(bit15.locator("span[title='0x8000']")).toHaveCount(1);
  await expectBit(bit15, 15, "1");

  const bit0 = bitRows(page).nth(15);
  await expect(bit0).toContainText("0 Bit 0");
  await expect(bit0.locator("span[title='0x0001']")).toHaveCount(1);
  await expectBit(bit0, 0, "1");

  // 中间位为 0。
  await expectBit(bitRows(page).nth(1), 14, "0");

  // 位行 Data 只有开关、没有输入框（2026-09-16 交互简化）。
  await expect(bitRows(page).locator(".register-table__bit-value")).toHaveCount(
    16,
  );
  await expect(
    bitRows(page).locator(".register-table__bit-value input"),
  ).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("点击切换位值同步父行当前值（不写设备、不进入编辑态）", async ({
  page,
}) => {
  await openApp(page);
  const first = parentRow(page, 0);
  await setBinaryType(page, first);
  await setAddress(first, "0");
  await mockSet(page, 0, 0x8001);
  await first.getByRole("button", { name: "Read", exact: true }).click();
  await expect(first.getByLabel("Data")).toHaveText("10000000 00000001", {
    timeout: 8000,
  });
  await first.locator('button[aria-label="Expand row"]').click();

  // bit15 由 1 → 0：父行 Data 随之更新（当前值，未下发设备）。
  await bitRows(page).nth(0).getByLabel("Toggle bit 15").click();
  await expect(first.getByLabel("Data")).toHaveText("00000000 00000001");
  await expectBit(bitRows(page).nth(0), 15, "0");

  // 位值只由开关操作（bit0 1 → 0）；位行 Data 无输入框可编辑。
  await bitRows(page).nth(15).getByLabel("Toggle bit 0").click();
  await expectBit(bitRows(page).nth(15), 0, "0");
  await expect(first.getByLabel("Data")).toHaveText("00000000 00000000");
});

test("范围行寄存器子行可再展开位明细（两层嵌套）", async ({ page }) => {
  await openApp(page);
  const first = parentRow(page, 0);
  // 先切 Type 再填范围：子行元数据在范围创建时继承父行 Type（ADR-031）。
  await setBinaryType(page, first);
  await setAddress(first, "0-1");
  await mockSet(page, 0, 0x8001);
  await mockSet(page, 1, 0x0002);
  await first.getByRole("button", { name: "Read", exact: true }).click();
  await expect(first.getByLabel("Data")).toHaveText(
    "10000000 00000001 00000000 00000010",
    { timeout: 8000 },
  );

  await first.locator('button[aria-label="Expand row"]').click();
  await expect(childRows(page)).toHaveCount(2);

  // 第 1 个寄存器子行：再展开位明细 → 16 行（bit15 = 1、bit0 = 1）。
  const child0 = childRows(page).nth(0);
  await child0.locator('button[aria-label="Expand row"]').click();
  await expect(bitRows(page)).toHaveCount(16);
  const bit15 = bitRows(page).nth(0);
  // 范围行：Address 列显示该寄存器实际地址（第 1 个寄存器 = 0）+ Bit 序号。
  await expect(bit15).toContainText("0 Bit 15");
  await expectBit(bit15, 15, "1");
  await expectBit(bitRows(page).nth(15), 0, "1");

  // 切换该位（1 → 0）：父行组合文本只更新该寄存器。
  await bit15.getByLabel("Toggle bit 15").click();
  await expect(first.getByLabel("Data")).toHaveText(
    "00000000 00000001 00000000 00000010",
  );
});

test("位名称/位注释可编辑并随工作区持久化（reload 恢复）", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });

  await openApp(page);
  const first = parentRow(page, 0);
  await setBinaryType(page, first);
  await setAddress(first, "0");
  await first.locator('button[aria-label="Expand row"]').click();

  // 位 Name 列可编辑（与 Comment 列同语义）。
  const bit15 = bitRows(page).nth(0);
  const name = bit15.getByLabel("Name");
  await name.click();
  await name.fill("Alarm bit");
  await name.press("Enter");
  await expect(bitRows(page).nth(0).getByLabel("Name")).toHaveText("Alarm bit");

  const comment = bitRows(page).nth(0).getByLabel("Comment");
  await comment.click();
  await comment.fill("alarm");
  await comment.press("Enter");
  await expect(bitRows(page).nth(0).getByLabel("Comment")).toHaveText("alarm");

  // IndexedDB 自动保存有防抖：reload 前等待落盘（既有 e2e 经验）。
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });

  const restored = parentRow(page, 0);
  await restored.locator('button[aria-label="Expand row"]').click();
  await expect(bitRows(page)).toHaveCount(16);
  await expect(bitRows(page).nth(0).getByLabel("Name")).toHaveText("Alarm bit");
  await expect(bitRows(page).nth(0).getByLabel("Comment")).toHaveText("alarm");

  expect(errors).toEqual([]);
});

test("未读取时开关内显示 — 代替 0，切换后出现 1/0", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });

  await openApp(page);
  const first = parentRow(page, 0);
  await setBinaryType(page, first);
  await setAddress(first, "0");
  // 不读取：位值未知 → 16 行位明细的开关内均显示 —（不再使用开关外侧占位）。
  await first.locator('button[aria-label="Expand row"]').click();
  await expect(bitRows(page)).toHaveCount(16);
  await expect(
    bitRows(page).locator(".register-table__bit-value-placeholder"),
  ).toHaveCount(0);
  await expectBit(bitRows(page).nth(15), 0, "—");

  // 切换 bit0（按全 0 基准 → 1）：父行 Data 同步，未选中侧恢复为 0。
  await bitRows(page).nth(15).getByLabel("Toggle bit 0").click();
  await expectBit(bitRows(page).nth(15), 0, "1");
  await expect(first.getByLabel("Data")).toHaveText("00000000 00000001");

  expect(errors).toEqual([]);
});
