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
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { clearWorkspaceFile } from "../clear-workspace-file";
import {
  closeIsolatedElectron,
  launchIsolatedElectron,
} from "../launch-isolated-electron";
import { expectNoConsoleErrors } from "../no-console-guard";

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
let userDataDir: string | undefined;
const consoleErrors: string[] = [];

/** 将当前表 Register 地址列进制切到 HEX（与从站规则地址一致）。 */
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
async function fillNumber(
  modal: Locator,
  label: string,
  value: string,
): Promise<void> {
  const item = modal.locator(".ant-form-item").filter({ hasText: label });
  const input = item.locator(".ant-input-number-input").first();
  await input.click();
  await input.fill(value);
}

/** 首行填入地址（HEX 4 位）并提交。 */
async function setRowAddress(p: Page, addressHex: string): Promise<void> {
  const cell = p.getByLabel("Address", { exact: true }).first();
  await cell.click();
  // 等待进入编辑态（click 触发 React 重渲染渲染出 input；高负载下可能延迟）。
  const input = p.getByLabel("Address", { exact: true }).first();
  await expect(input).toBeEditable({ timeout: 5000 });
  // Playwright fill() 用原生 value setter 设置 DOM 值，偶发不触发 React onChange
  // （draftRef 未同步但 DOM value 已变，toHaveValue 假通过，Enter 提交读到旧 draft 而
  // 短路）。使用 fill("")+pressSequentially 逐字符输入（真实键盘事件，onChange 必然触发），
  // toHaveValue 确认受控值同步后再 Enter。
  await input.fill("");
  await input.pressSequentially(addressHex, { delay: 10 });
  await expect(input).toHaveValue(addressHex);
  await input.press("Enter");
  await expect(
    p.getByRole("button", { name: "Read", exact: true }).first(),
  ).toBeEnabled({ timeout: 5000 });
}

/** 首行点击 Read。 */
async function readRow(p: Page): Promise<void> {
  await p
    .getByRole("button", { name: "Read", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

/** 显式切换当前表的写后回读配置。 */
async function setWriteVerify(p: Page, optionText: string): Promise<void> {
  const verify = p.locator(".table-toolbar__verify");
  await verify.getByLabel("Write verification").click();
  await p
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: new RegExp(`^${optionText}$`) })
    .first()
    .click();
  await expect(verify).toContainText(optionText, { timeout: 5000 });
}

/** 首行填 Data（HEX）并点击 Write。 */
async function writeRow(p: Page, valueHex: string): Promise<void> {
  const cell = p.getByLabel("Data").first();
  const previousText = ((await cell.textContent()) ?? "").trim();
  await cell.click();
  // 同 setRowAddress：等待编辑态 + pressSequentially 逐字符输入 + toHaveValue 同步。
  const data = p.getByLabel("Data").first();
  await expect(data).toBeEditable({ timeout: 5000 });
  await data.fill("");
  await data.pressSequentially(valueHex, { delay: 10 });
  await expect(data).toHaveValue(valueHex);
  await data.press("Enter");
  if (previousText.toUpperCase() !== valueHex.toUpperCase()) {
    await expect(
      p.locator(".register-table__status-dot--dirty").first(),
    ).toBeVisible({ timeout: 5000 });
  }
  await p
    .getByRole("button", { name: "Write", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

test.beforeAll(async () => {
  const launched = await launchIsolatedElectron({
    executablePath: require("electron"),
    mainEntry: "dist-electron/main.js",
    cwd: REPO_ROOT,
  });
  app = launched.app;
  userDataDir = launched.userDataDir;
  page = await app.firstWindow();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`CONSOLE: ${msg.text()}`);
  });
  page.on("pageerror", (err) =>
    consoleErrors.push(`PAGEERROR: ${String(err)}`),
  );

  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name !== undefined) indexedDB.deleteDatabase(db.name);
    }
  });
  // 工作区持久化使用文件仓储：IndexedDB 清理不涉及工作区，
  // 一并删除 userData 下 workspace.json(.bak)，避免跨测试/跨运行污染。
  await clearWorkspaceFile(app);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector(".ant-modal-container:visible", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test.afterAll(async () => {
  await closeIsolatedElectron(app, userDataDir);
  expectNoConsoleErrors(consoleErrors);
});

test("TCP 连接：按 config tcp-local-slave 填 host/port/unitId → Connect → Online", async () => {
  const tcp = tcpConfig();
  const modal = page.locator(".ant-modal-container:visible");

  // 切到 Modbus TCP（Segmented）。
  const tcpProtocolItem = modal
    .locator(".ant-segmented-item")
    .filter({ hasText: "Modbus TCP" });
  await tcpProtocolItem.click();
  await expect(modal.getByRole("radio", { name: "Modbus TCP" })).toBeChecked();

  // host（占位符 192.168.1.10 的 Input）。
  const hostInput = modal.getByPlaceholder("192.168.1.10");
  await expect(hostInput).toBeVisible({ timeout: 5000 });
  await hostInput.fill(tcp.host);
  // TCP Port / Unit ID（Form.Item 定位）。
  await fillNumber(modal, "TCP Port", String(tcp.port));
  await fillNumber(modal, "Unit ID", String(tcp.unitId));

  // Connect → Online。
  await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: CONNECTED_TIMEOUT,
  });
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);
  // 主进程 TCP 会话已连接是实际选择 TCP 的运行时证据；RTU 连接不会打开该会话。
  const sessionState = await page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        mamepHost: {
          sessionGetState(): Promise<{
            ok: boolean;
            value?: { connectionState?: string };
          }>;
        };
      }
    ).mamepHost;
    return bridge.sessionGetState();
  });
  expect(sessionState.ok).toBe(true);
  expect(sessionState.value?.connectionState).toBe("connected");

  await setRadixHex(page);
});

test("TCP：FC03 读正常区 0x0000 → 0x04D2（从站初始值 1234）", async () => {
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("04D2", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test("TCP：FC0x10 写正常区 0x0001=0x12AB + 读回验证", async () => {
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

test("TCP：写值门控 0x0400：写 0x8000 被拒（异常 0x03），写 0x1234 成功", async () => {
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

test("TCP：异常区：只读 0x0100 写 / 只写 0x0200 读 / 不存在 0x0300 读 / 不支持功能 0x0500 读", async () => {
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

test("TCP：no-response 0x0600：读超时错误，且不破坏后续请求", async () => {
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

test("TCP：边界：地址 0 与最大地址 0xFFFF（规则外回退正常）", async () => {
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

test("TCP：扩展：分片响应 0x0800 读写成功（半包/粘包组帧健壮性）", async () => {
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

test("TCP：扩展：延迟响应 0x0700 读超时（迟到丢弃），后续正常", async () => {
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

test("TCP：通信日志：请求/响应/异常帧字节", async () => {
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
  // Listy 虚拟列表默认停在底部（最新帧可见）；最早帧（写门控异常 01 90 03）可能被挤出
  // 视口（TCP 帧含 MBAP 头行更高，且延迟响应的迟到帧也会占用视口）。滚动到顶部让最早帧
  // 渲染后断言，再滚回底部断言最新帧。
  await list.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(300);
  await expect(list).toContainText("01 90 03", { timeout: 5000 });
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(300);
  await expect(list).toContainText("01 90 02", { timeout: 5000 });
  await expect(list).toContainText("01 03 00 00 00 01", { timeout: 5000 });
  await expect(list).toContainText("01 03 02 04 D2", { timeout: 5000 });
});

test("TCP：写后回读 Verify：默认 OFF，显式 ON 后写忽略区 0x0900 显示回读值 0000", async () => {
  // 写忽略区（0x0900–0x090f）：写入返回正常成功帧但不落盘——回读仍为旧值 0。
  // 新表默认 OFF；本用例显式 ON，写入后立即 FC03 回读 → 值不一致 → 失败点（红点），
  // Data 列被回读值覆盖（§15.1）显示 0000 而非写入的 1234。
  await expect(page.locator(".table-toolbar__verify")).toContainText("OFF");
  await setWriteVerify(page, "ON");
  await setRowAddress(page, "0900");
  await writeRow(page, "1234");
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await expect(page.getByLabel("Data").first()).toHaveText("0000", {
    timeout: CONNECTED_TIMEOUT,
  });
  await expect(page.getByLabel("Data").first()).not.toHaveText("1234");
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("0000", {
    timeout: CONNECTED_TIMEOUT,
  });
  await setWriteVerify(page, "OFF");
});

test("断开连接 → Offline，重连 → Online（稳定性）", async () => {
  await page.getByRole("button", { name: /Disconnect/i }).click();
  // Header 连接按钮已整合，断开后显示 Connect 态、无 "Offline" 文本；以 data-conn-state 判定。
  await expect(
    page.locator(".connection-cluster__button[data-conn-state='disconnected']"),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });

  // 重连：重新打开 Connection Settings，切 TCP 并重填（值仍来自 config）。
  await page
    .getByRole("button", { name: "Connection" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".ant-modal-container:visible", {
    timeout: 8000,
  });
  const modal = page.locator(".ant-modal-container:visible");
  const tcp = tcpConfig();
  const tcpProtocolItem = modal
    .locator(".ant-segmented-item")
    .filter({ hasText: "Modbus TCP" });
  await tcpProtocolItem.click();
  await expect(modal.getByRole("radio", { name: "Modbus TCP" })).toBeChecked();
  const hostInput = modal.getByPlaceholder("192.168.1.10");
  await expect(hostInput).toBeVisible({ timeout: 5000 });
  await hostInput.fill(tcp.host);
  await fillNumber(modal, "TCP Port", String(tcp.port));
  await fillNumber(modal, "Unit ID", String(tcp.unitId));
  await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: CONNECTED_TIMEOUT,
  });
  const sessionState = await page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        mamepHost: {
          sessionGetState(): Promise<{
            ok: boolean;
            value?: { connectionState?: string };
          }>;
        };
      }
    ).mamepHost;
    return bridge.sessionGetState();
  });
  expect(sessionState.ok).toBe(true);
  expect(sessionState.value?.connectionState).toBe("connected");
});
