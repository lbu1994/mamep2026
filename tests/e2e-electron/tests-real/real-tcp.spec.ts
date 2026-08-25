/**
 * Electron 端「真实 Modbus TCP」e2e（本地回环真实 net 端口）。
 *
 * 生产构建路径启动（dist-electron/main.js + apps/web/dist-electron/，loadFile）。
 * 真实路径：Connection Settings 切 Modbus TCP → 按 config/connections.json
 * tcp-local-slave（host/port/unitId，本 spec 读取该文件不硬编码）填表 → 主进程
 * ElectronSessionHost（NodeTcpTransport + TcpSessionHost）真实 TCP 连接真实 TCP 从站
 * （scripts/modbus-slave/modbus-tcp-slave.mjs，runner 拉起）。
 *
 * 门控：仅 MAMEP_REAL=1（由 scripts/e2e-real.mjs 设置）时运行。
 * 运行方式：pnpm test:e2e:electron:real（runner 预检 TCP 端口 + 拉起 TCP 从站）。
 *
 * 场景：连接 Online → FC03 读 / FC10 写 + 读回 → 写值门控 → 异常区 → no-response
 * 超时 → 边界 → 扩展（分片/延迟）→ 通信日志 → 断开/重连 → 无 console 错误。
 */
import {
  _electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
/** 仓库根目录（本文件位于 tests/e2e-electron/tests-real/）。 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const CONNECTED_TIMEOUT = 15_000;

// 门控：真实端口测试需显式开启（MAMEP_REAL=1，由 scripts/e2e-real.mjs 设置）。
test.skip(
  process.env.MAMEP_REAL !== "1",
  "真实端口测试需显式开启（MAMEP_REAL=1，由 pnpm test:e2e:electron:real 触发）",
);

/** 读取 config/connections.json 的 tcp-local-slave（连接参数唯一事实源，不硬编码）。 */
function tcpConfig(): { host: string; port: number; unitId: number } {
  const raw = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "config", "connections.json"), "utf8"),
  );
  const conn = raw.connections.find(
    (c: { id: string }) => c.id === "tcp-local-slave",
  );
  if (conn === undefined)
    throw new Error("config/connections.json 缺少 tcp-local-slave");
  return {
    host: conn.host,
    port: conn.port,
    unitId: conn.unitId ?? 1,
  };
}

let app: ElectronApplication;
let page: Page;
const consoleErrors: string[] = [];

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

/** 在弹窗内按 Form.Item 标签定位并填写 InputNumber（TCP Port / Unit ID 等）。 */
async function fillNumber(modal: Locator, label: string, value: string): Promise<void> {
  const item = modal.locator(".ant-form-item").filter({ hasText: label });
  const input = item.locator(".ant-input-number-input").first();
  await input.click();
  await input.fill(value);
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
  app = await _electron.launch({
    executablePath: require("electron"),
    args: ["dist-electron/main.js"],
    cwd: REPO_ROOT,
  });
  page = await app.firstWindow();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`CONSOLE: ${msg.text()}`);
  });
  page.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${String(err)}`));

  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name !== undefined) indexedDB.deleteDatabase(db.name);
    }
  });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector(".ant-modal-container:visible", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test.afterAll(async () => {
  try {
    await app.close();
  } catch {
    // 已关闭。
  }
});

test("TCP 连接：按 config tcp-local-slave 填 host/port/unitId → Connect → Online", async () => {
  const tcp = tcpConfig();
  const modal = page.locator(".ant-modal-container:visible");

  // 切到 Modbus TCP（Segmented）。
  await modal
    .locator(".ant-segmented-item")
    .filter({ hasText: "Modbus TCP" })
    .click();

  // host（占位符 192.168.1.10 的 Input）。
  await modal.getByPlaceholder("192.168.1.10").fill(tcp.host);
  // TCP Port / Unit ID（Form.Item 定位）。
  await fillNumber(modal, "TCP Port", String(tcp.port));
  await fillNumber(modal, "Unit ID", String(tcp.unitId));

  // Connect → Online。
  await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: CONNECTED_TIMEOUT,
  });
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);

  await setRadixHex(page);
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
  ).toHaveAttribute("aria-label", "The device returned a Modbus exception.");
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
  await setRowAddress(page, "0100");
  await writeRow(page, "0001");
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });

  await setRowAddress(page, "0200");
  await readRow(page);
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });

  await setRowAddress(page, "0300");
  await readRow(page);
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });

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
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("04D2", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test("边界：地址 0 与最大地址 0xFFFF（规则外回退正常）", async () => {
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("04D2", {
    timeout: CONNECTED_TIMEOUT,
  });
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
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("04D2", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test("通信日志：请求/响应/异常帧字节", async () => {
  // Listy 虚拟列表只渲染视口内的行：共享 app 下历史帧已被滚动挤出，
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
  await expect(list).toContainText("01 03 00 00 00 01", { timeout: 5000 });
  await expect(list).toContainText("01 03 02 04 D2");
  await expect(list).toContainText("01 90 03");
  await expect(list).toContainText("01 90 02");
});

test("断开连接 → Offline，重连 → Online（稳定性）", async () => {
  await page.getByRole("button", { name: /Disconnect/i }).click();
  await expect(page.locator(".ant-layout-header")).toContainText("Offline", {
    timeout: CONNECTED_TIMEOUT,
  });

  // 重连：重新打开 Connection Settings，切 TCP 并重填（值仍来自 config）。
  await page
    .getByRole("button", { name: "Connection" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".ant-modal-container:visible", {
    timeout: 8000,
  });
  const modal = page.locator(".ant-modal-container:visible");
  const tcp = tcpConfig();
  await modal
    .locator(".ant-segmented-item")
    .filter({ hasText: "Modbus TCP" })
    .click();
  await modal.getByPlaceholder("192.168.1.10").fill(tcp.host);
  await fillNumber(modal, "TCP Port", String(tcp.port));
  await fillNumber(modal, "Unit ID", String(tcp.unitId));
  await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test("无 console 错误（含 CSP 违规、antd 弃用）", async () => {
  expect(
    consoleErrors,
    `console/page errors: ${consoleErrors.join(" | ")}`,
  ).toEqual([]);
});
