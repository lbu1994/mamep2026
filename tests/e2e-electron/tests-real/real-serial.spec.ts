/**
 * Electron 端「真实串口」RTU e2e（com0com COM4↔COM5 + 真实 Web Serial）。
 *
 * 生产构建路径启动（dist-electron/main.js + apps/web/dist-electron/，loadFile）。
 * 真实端口路径：Renderer Web Serial（主进程 select-serial-port 最小授权）→
 * Connection Settings 串口下拉（用户手势触发枚举，主进程转发端口列表）→
 * 自动选择配置文件中指定的串口（config/connections.json rtu-com4-master.port，
 * 本 spec 读取该文件，不硬编码）→ 真实串口读写闭环。
 *
 * 门控：仅 MAMEP_REAL=1（由 scripts/e2e-real.mjs 设置）时运行。
 * 运行方式：pnpm test:e2e:electron:real（runner 预检 + 拉起 COM5 从站）。
 *
 * 场景与浏览器 real-serial 一致：连接 Online → FC03 读 / FC10 写 + 读回 → 写值门控
 * → 异常区 → no-response 超时 → 边界 → 扩展（分片/延迟）→ 通信日志 → 断开 → 无 console 错误。
 */
import {
  _electron,
  expect,
  test,
  type ElectronApplication,
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

/** 读取 config/connections.json 的 rtu-com4-master（连接参数唯一事实源，不硬编码）。 */
function rtuConfig(): { port: string; baudRate: number; slaveAddress: number } {
  const raw = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "config", "connections.json"), "utf8"),
  );
  const conn = raw.connections.find(
    (c: { id: string }) => c.id === "rtu-com4-master",
  );
  if (conn === undefined) throw new Error("config/connections.json 缺少 rtu-com4-master");
  return { port: conn.port, baudRate: conn.baudRate, slaveAddress: conn.slaveAddress };
}

let app: ElectronApplication;
let page: Page;
const consoleErrors: string[] = [];

/** 将当前表 Register 地址列进制切到 HEX（与从站规则地址一致，ADR-014）。 */
async function setRadixHex(p: Page): Promise<void> {
  await p.locator(".table-toolbar__radix .ant-select").first().click();
  await p
    .locator(".ant-select-dropdown:visible")
    .getByText("HEX", { exact: true })
    .click();
  await expect(p.locator(".table-toolbar__radix")).toContainText("HEX", {
    timeout: 5000,
  });
}

/** 首行填入地址（HEX 4 位）并提交。 */
async function setRowAddress(p: Page, addressHex: string): Promise<void> {
  const input = p.getByLabel("Register", { exact: true }).first();
  await input.click();
  await input.fill(addressHex);
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

  // 清理 IndexedDB 避免跨运行残留工作区，随后重载生效。
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name !== undefined) indexedDB.deleteDatabase(db.name);
    }
  });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  // 非 mock 启动自动弹出 Connection Settings。
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

test("RTU 自动选择 COM4（来自 config/connections.json）+ 连接 Online", async () => {
  const rtu = rtuConfig();
  const modal = page.locator(".ant-modal-container:visible");

  // 打开端口下拉框（用户手势触发枚举 → 主进程转发端口列表 → 选项出现）。
  await modal.locator(".ant-select").first().click();
  const option = page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: rtu.port });
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await option.click();

  // 端口标签出现在弹窗（已选中）。
  await expect(modal).toContainText(rtu.port, { timeout: 8000 });

  // Connect → Online，弹窗关闭。
  await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: CONNECTED_TIMEOUT,
  });
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);

  // 地址进制切到 HEX，便于按从站规则地址操作。
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
  await page.getByRole("tab", { name: "Comm Log" }).click();
  await page.waitForTimeout(200);
  const list = page.locator(".comm-log .ant-listy-holder");
  await expect(list).toContainText("01 03 00 00 00 01", { timeout: 5000 });
  await expect(list).toContainText("01 03 02 04 D2");
  await expect(list).toContainText("01 90 03");
  await expect(list).toContainText("01 90 02");
});

test("断开连接 → Offline，可重连 → Online（稳定性）", async () => {
  // 断开。
  await page.getByRole("button", { name: /Disconnect/i }).click();
  await expect(page.locator(".ant-layout-header")).toContainText("Offline", {
    timeout: CONNECTED_TIMEOUT,
  });

  // 重连：打开 Connection Settings → 串口下拉已可复用授权快照（enumerated 自动匹配 COM4）。
  await page
    .getByRole("button", { name: "Connection" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".ant-modal-container:visible", {
    timeout: 8000,
  });
  const modal = page.locator(".ant-modal-container:visible");
  const rtu = rtuConfig();
  // 打开下拉触发枚举（用户手势），等待 COM4 选项后选择。
  await modal.locator(".ant-select").first().click();
  const option = page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: rtu.port });
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await option.click();
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
