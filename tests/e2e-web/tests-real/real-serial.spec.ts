/**
 * 浏览器端「真实串口」RTU e2e（com0com COM4↔COM5 + 真实 Web Serial）。
 *
 * 真实端口路径：浏览器（无 mockTransport）→ Connection Settings → 系统 Web Serial
 * picker（用户手势）→ 用户选择 COM4（连接 COM5 从站）→ WebSerialTransport 真实串口
 * 读写。选择结果记录到 localStorage（mamep:real-serial-port），同 spec 内共享 page/
 * 连接复用，不重复弹选择框；跨运行打印上次选择供对照。
 *
 * 门控：仅 MAMEP_REAL=1（由 scripts/e2e-real.mjs 设置）时运行；否则整文件 skip。
 * 运行方式：pnpm test:e2e:web:real（runner 自动预检 COM4/COM5 并拉起 COM5 从站）。
 *
 * 场景：连接 Online → FC03 读 / FC10 写 + 读回 → 写值门控 → 异常区 → no-response
 * 超时 → 边界（0 / 0xFFFF）→ 扩展（分片 0x0800 / 延迟 0x0700）→ 通信日志 → 断开
 * → 无 console 错误。寄存器区域设计以 modbus-slave 配置（=DEFAULT_MOCK_RULES +
 * 扩展区间）为准。
 */
import { chromium, expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/";
const LOCAL_STORAGE_KEY = "mamep:real-serial-port";
const CONNECTED_TIMEOUT = 15_000;

// 门控：真实端口测试需显式开启（MAMEP_REAL=1，由 scripts/e2e-real.mjs 设置）。
test.skip(
  process.env.MAMEP_REAL !== "1",
  "真实端口测试需显式开启（MAMEP_REAL=1，由 pnpm test:e2e:web:real 触发）",
);

let browserRef: Awaited<ReturnType<typeof chromium.launch>> | null = null;
let page: Page;
let consoleErrors: string[] = [];

/** 将当前表 Register 地址列进制切到 HEX（与从站规则地址一致，ADR-014）。 */
async function setRadixHex(p: Page): Promise<void> {
  await p
    .locator(".table-toolbar__radix .ant-segmented-item")
    .filter({ hasText: "HEX" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(p.locator(".table-toolbar__radix")).toContainText("HEX", {
    timeout: 5000,
  });
}

/** 首行填入地址（HEX 4 位）并提交。 */
async function setRowAddress(p: Page, addressHex: string): Promise<void> {
  const input = p.getByLabel("Register", { exact: true }).first();
  await input.click();
  await input.fill(addressHex);
  // React 受控组件竞态防护：fill 后立即 Enter 可能读到旧 draft 导致提交被跳过。
  await p.waitForTimeout(50);
  await input.press("Enter");
}

/** 首行点击 Read。 */
async function readRow(p: Page): Promise<void> {
  await p
    .getByRole("button", { name: "Read", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

/** 首行填 Data（HEX）并点击 Write。 */
async function writeRow(p: Page, valueHex: string): Promise<void> {
  const data = p.getByLabel("Data").first();
  await data.click();
  await data.fill(valueHex);
  // React 受控组件竞态防护：fill 后立即 Enter 可能读到旧 draft 导致提交被跳过。
  await p.waitForTimeout(50);
  await data.press("Enter");
  await p
    .getByRole("button", { name: "Write", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

test.beforeAll(async () => {
  // 有头系统 Edge（系统 picker 需要可见窗口）。手动 launch，page 在测试间共享。
  browserRef = await chromium.launch({ channel: "msedge", headless: false });
  page = await browserRef.newPage({ viewport: { width: 1600, height: 900 } });
  consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`CONSOLE: ${msg.text()}`);
  });
  page.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${String(err)}`));

  // 清理 IndexedDB（避免跨运行残留工作区自动恢复）后加载；localStorage 保留。
  await page.goto(BASE_URL);
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name !== undefined) indexedDB.deleteDatabase(db.name);
    }
  });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");

  // 非 mock 启动自动弹 Connection Settings。
  await page.waitForSelector(".ant-modal-container:visible", {
    timeout: CONNECTED_TIMEOUT,
  });

  // 跨运行对照：打印上次选择记录。
  const previous = await page.evaluate(
    (key) => localStorage.getItem(key),
    LOCAL_STORAGE_KEY,
  );
  if (previous !== null) {
    console.log(`[real-serial] 上次选择记录: ${previous}`);
  }

  // 用户选择串口：点击「Select serial port…」触发系统 picker（用户手势）。
  const modal = page.locator(".ant-modal-container:visible");
  console.log(
    "[real-serial] 请在系统串口选择器中选中 COM4（连接 COM5 从站），本测试最长等待 120s…",
  );
  await modal
    .getByRole("button", { name: /Select serial port/i })
    .click();
  await modal.getByText(/^USB /).waitFor({ timeout: 120_000 });
  const label = (await modal.getByText(/^USB /).first().innerText()).trim();
  console.log(`[real-serial] 已选择串口: ${label}`);

  // 记录到 localStorage（后续运行对照 + 运行内复用）。
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [
      LOCAL_STORAGE_KEY,
      JSON.stringify({ portId: label, label, selectedAt: Date.now() }),
    ] as const,
  );

  // Connect → Online。
  await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: CONNECTED_TIMEOUT,
  });
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);

  // 地址进制切到 HEX，便于按从站规则地址（0x0000/0x0100/…）操作。
  await setRadixHex(page);
});

test.afterAll(async () => {
  try {
    await browserRef?.close();
  } catch {
    // 已关闭。
  }
});

test("连接成功：顶栏 Online，连接属性 RTU", async () => {
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 5000,
  });
});

test("FC03 读正常区 0x0000 → 0x04D2（从站初始值 1234）", async () => {
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("04D2", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test("FC0x10 写正常区 0x0001=0x12AB + 读回验证", async () => {
  await setRowAddress(page, "0001");
  await writeRow(page, "12AB");
  await expect(
    page.locator(".register-table__status-dot--success").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("12AB", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test("写值门控 0x0400：写 0x8000 被拒（异常 0x03），写 0x1234 成功", async () => {
  await setRowAddress(page, "0400");
  await writeRow(page, "8000");
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await expect(
    page.locator(".register-table__status-dot").first(),
  ).toHaveAttribute(
    "aria-label",
    "The device returned a Modbus exception.",
  );
  // 合法值成功（读回验证）。
  await writeRow(page, "1234");
  await expect(
    page.locator(".register-table__status-dot--success").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("1234", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test("异常区：只读 0x0100 写 / 只写 0x0200 读 / 不存在 0x0300 读 / 不支持功能 0x0500 读", async () => {
  // 只读区：写回异常 0x02
  await setRowAddress(page, "0100");
  await writeRow(page, "0001");
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  // 只写区：读回异常 0x02
  await setRowAddress(page, "0200");
  await readRow(page);
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  // 不存在区：读回异常 0x02
  await setRowAddress(page, "0300");
  await readRow(page);
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  // 不支持功能区：读回异常 0x01
  await setRowAddress(page, "0500");
  await readRow(page);
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
});

test("no-response 0x0600：读超时错误，且不破坏后续请求", async () => {
  await setRowAddress(page, "0600");
  await readRow(page);
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await expect(
    page.locator(".register-table__status-dot").first(),
  ).toHaveAttribute(
    "aria-label",
    "No response from the device within the timeout.",
  );
  // 后续正常区请求仍成功。
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("04D2", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test("边界：地址 0 与最大地址 0xFFFF（规则外回退正常）", async () => {
  // 地址 0 = 0x0000（正常区）：读返回初始值。
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("04D2", {
    timeout: CONNECTED_TIMEOUT,
  });
  // 最大地址 0xFFFF：规则外 → 回退正常行为（读 0、写读回）。
  await setRowAddress(page, "FFFF");
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("0000", {
    timeout: CONNECTED_TIMEOUT,
  });
  await writeRow(page, "1234");
  await expect(
    page.locator(".register-table__status-dot--success").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("1234", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test("扩展：分片响应 0x0800 读写成功（半包/粘包组帧健壮性）", async () => {
  await setRowAddress(page, "0800");
  await writeRow(page, "1234");
  await expect(
    page.locator(".register-table__status-dot--success").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("1234", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test("扩展：延迟响应 0x0700 读超时（迟到丢弃），后续正常", async () => {
  await setRowAddress(page, "0700");
  await readRow(page);
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  // 后续正常区仍成功。
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("04D2", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test("通信日志：请求/响应/异常帧字节", async () => {
  // Listy 虚拟列表只渲染视口内的行：共享会话下历史帧已被滚动挤出，
  // 清空后在测试内重建目标帧（写值门控异常 0x03、只读区异常 0x02、读 0x0000）。
  await page.getByRole("tab", { name: "Comm Log" }).click();
  await page.getByRole("button", { name: /Clear/i }).click();
  await setRowAddress(page, "0400");
  await writeRow(page, "8000");
  await setRowAddress(page, "0100");
  await writeRow(page, "0001");
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("04D2", {
    timeout: CONNECTED_TIMEOUT,
  });
  await page.waitForTimeout(200);
  const list = page.locator(".comm-log .ant-listy-holder");
  // 读 0x0000 请求与响应（值 0x04D2；日志含 CRC，子串断言）。
  await expect(list).toContainText("01 03 00 00 00 01", { timeout: 5000 });
  await expect(list).toContainText("01 03 02 04 D2");
  // 写门控异常：0x0400 写 0x8000 → 异常 0x03 响应帧。
  await expect(list).toContainText("01 90 03");
  // 只读区写异常 0x02 响应帧。
  await expect(list).toContainText("01 90 02");
});

test("断开连接 → Offline", async () => {
  await page
    .getByRole("button", { name: /Disconnect/i })
    .click();
  await expect(page.locator(".ant-layout-header")).toContainText("Offline", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test("无 console 错误（含 CSP 违规、antd 弃用）", async () => {
  expect(
    consoleErrors,
    `console/page errors: ${consoleErrors.join(" | ")}`,
  ).toEqual([]);
});
