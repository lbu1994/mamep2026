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
  type Locator,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { clearWorkspaceFile } from "../clear-workspace-file";

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
  // 限定到活动表选项卡的工具栏（多 Sheet 时每个表各有工具栏，不得命中隐藏表）。
  const toolbar = p.locator(
    ".register-table-tabs .ant-tabs-content-active .table-toolbar__radix",
  );
  await toolbar
    .locator(".ant-segmented-item")
    .filter({ hasText: "HEX" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(toolbar).toContainText("HEX", { timeout: 5000 });
}
/**
 * 把 RTU 超时 Select 设为固定档位。真实端口 e2e 稳定连接：应用默认超时已改为 50ms
 * （2026-09-06），对 com0com 虚拟串口偏紧，测试连接显式手动输入 Select 上限 100ms。
 * 通过 showSearch 的手动输入（键入数值 + Enter）选中，避免点击下拉选项的脆弱性。
 * 应用默认维持 50ms 不变，仅测试连接放宽。
 */
async function setRtuTimeoutSelect(
  p: Page,
  modal: Locator,
  timeoutMs: number,
): Promise<void> {
  const select = modal
    .locator(".ant-form-item")
    .filter({ hasText: "Timeout" })
    .locator(".ant-select")
    .first();
  await select.click();
  // 清空搜索框内容（若已预填充）后键入目标值并按 Enter 选中。
  await p.keyboard.press("Control+a");
  await p.keyboard.type(String(timeoutMs));
  await p.keyboard.press("Enter");
  // 确认 Select 回显选中值。
  await expect(modal).toContainText(`${timeoutMs} ms`, { timeout: 5000 });
}
/**
 * 活动表内容面板（多 Sheet 时限定到当前活动表，避免命中隐藏表单元格/工具栏）。
 * antd v6 活动面板 DOM 类名为 `.ant-tabs-content-active`（AGENTS.md「antd v6 关键差异」）。
 */
const activeTable = (p: Page) =>
  p.locator(".register-table-tabs .ant-tabs-content-active");

/** 首行填入地址（HEX 4 位）并提交。 */
async function setRowAddress(p: Page, addressHex: string): Promise<void> {
  const cell = activeTable(p).getByLabel("Register", { exact: true }).first();
  await cell.click();
  // 等待进入编辑态：click 触发 React 重渲染渲染出 input（生产构建高负载下可能延迟，
  // 且前序读/写操作的行重渲染尚未 settle 时点击可能命中旧节点）。toBeEditable 自动
  // 重试直到 input 出现，比裸 waitForTimeout 可靠（2026-08-26 real e2e 竞态）。
  const input = activeTable(p).getByLabel("Register", { exact: true }).first();
  await expect(input).toBeEditable({ timeout: 5000 });
  // Playwright fill() 用原生 value setter 设置 DOM 值，偶发不触发 React onChange
  // （draftRef 未同步但 DOM value 已变，toHaveValue 假通过，Enter 提交读到旧 draft 而
  // 短路——real e2e 曾致地址提交被跳过）。改 fill("")+pressSequentially 逐字符输入
  // （真实键盘事件，onChange 必然触发），toHaveValue 确认受控值同步后再 Enter。
  await input.fill("");
  await input.pressSequentially(addressHex, { delay: 10 });
  await expect(input).toHaveValue(addressHex);
  await input.press("Enter");
}

/** 首行点击 Read。 */
async function readRow(p: Page): Promise<void> {
  await activeTable(p)
    .getByRole("button", { name: "Read", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

/** 首行填 Data（HEX）并点击 Write。 */
async function writeRow(p: Page, valueHex: string): Promise<void> {
  const cell = activeTable(p).getByLabel("Data").first();
  await cell.click();
  // 同 setRowAddress：等待编辑态 + pressSequentially 逐字符输入（fill 偶发不触发
  // React onChange 致提交短路）+ toHaveValue 确认受控值同步后再 Enter。
  const data = activeTable(p).getByLabel("Data").first();
  await expect(data).toBeEditable({ timeout: 5000 });
  await data.fill("");
  await data.pressSequentially(valueHex, { delay: 10 });
  await expect(data).toHaveValue(valueHex);
  await data.press("Enter");
  await activeTable(p)
    .getByRole("button", { name: "Write", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

/** 通过侧边栏分组「+」按钮新建基础表/自定义表（aria-label = 组标题）。 */
async function addBasicSheet(p: Page, groupTitle: string): Promise<void> {
  await p
    .getByRole("button", { name: groupTitle, exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

/**
 * 以当前活动表协议重新连接（真实串口，自动枚举并选中 config/connections.json 的
 * rtu-com4-master.port，无系统 picker）。用于切换到基础表/自定义表 codec 后重连。
 */
async function reconnectAsActiveSheet(p: Page): Promise<void> {
  // 1) 断开（已连接时弹窗按钮是 Disconnect）。
  await p
    .getByRole("button", { name: /Disconnect/i })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(p.locator(".ant-layout-header")).not.toContainText("Disconnect", {
    timeout: CONNECTED_TIMEOUT,
  });
  // 2) 打开 Connection Settings → 端口下拉枚举 → 选择 COM4 → Connect。
  await p
    .getByRole("button", { name: "Connection" })
    .evaluate((el) => (el as HTMLElement).click());
  await p.waitForSelector(".ant-modal-container:visible", { timeout: 8000 });
  const modal = p.locator(".ant-modal-container:visible");
  const rtu = rtuConfig();
  await modal
    .locator(".ant-form-item")
    .filter({ hasText: "Port" })
    .locator(".ant-select")
    .first()
    .click();
  const option = p
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: rtu.port });
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await option.click();
  await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
  await expect(p.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: CONNECTED_TIMEOUT,
  });
  await expect(p.locator(".ant-modal-container:visible")).toHaveCount(0);
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
  // 工作区持久化已改为文件仓储（ADR-036，2026-08-30）：IndexedDB 清理不再清除工作区，
  // 一并删除 userData 下 workspace.json(.bak)，避免跨测试/跨运行污染。
  await clearWorkspaceFile(app);
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
  // 按 Port Form.Item 限定定位端口下拉（连接对象配置分组已移除，ADR-034）。
  await modal
    .locator(".ant-form-item")
    .filter({ hasText: "Port" })
    .locator(".ant-select")
    .first()
    .click();
  const option = page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: rtu.port });
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await option.click();

  // 端口标签出现在弹窗（已选中）。
  await expect(modal).toContainText(rtu.port, { timeout: 8000 });
  // 真实端口稳定连接：RTU 超时手动输入设 Select 上限 100ms。
  await setRtuTimeoutSelect(page, modal, 100);

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
  // 从站对 0x0700 的延迟响应（2500ms）落在主站超时窗口（requestTimeoutMs 50ms ×
  // retryCount+1 共 2 次 ≈ 100ms）之后才到达；若此时立即发起新读，RTU 无 Transaction ID
  // 会把迟到的 0x0700 响应当作新读的响应（真实串口时序竞态，曾致读 0x0000 返回 0x0700
  // 的值 0000）。两次重试（attempt1/attempt2）均在 ~100ms 内超时，两帧迟到响应各在其请求
  // 后 ~2500ms 到达（~2500 / ~2550ms）。等两帧迟到响应都在无活动请求时（pendingExchange
  // 为空）到达并被丢弃，再读回正常区（2026-09-06：默认超时改 50ms，等待 3000ms 覆盖）。
  await page.waitForTimeout(3000);
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
  // Listy 虚拟列表默认停在底部（最新帧可见）；最早帧（写门控异常 01 90 03）可能被挤出
  // 视口（延迟响应的迟到帧也会占用视口）。滚动到顶部让最早帧渲染后断言，再滚回底部
  // 断言最新帧（2026-08-26 real e2e 修复）。
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

test("写后回读 Verify=ON（默认）：写忽略区 0x0900 写入回执成功，但 Data 列显示回读值 0000", async () => {
  // 写忽略区（0x0900–0x090f）：写入返回正常成功帧但不落盘——回读仍为旧值 0。
  // Verify=ON（本表默认）：写入后立即 FC03 回读 → 值不一致 → 失败点（红点），
  // Data 列被回读值覆盖（§15.1）显示 0000 而非写入的 1234。
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
});

test("基础表与自定义功能码（真实端口）：FC01/FC02/FC04/FC0F + FC65/FC66", async () => {
  // 所有行断言限定到活动表（多 Sheet 时不得命中隐藏表）。
  const dataCell = () => activeTable(page).getByLabel("Data").first();
  const okDot = () =>
    activeTable(page).locator(".register-table__status-dot--success").first();

  // 线圈表：FC01 读 coil0（配置预置 1）→ 位值 "1"；FC0F 写 0 → 读回 "0"。
  await addBasicSheet(page, "Coils (01H/0FH)");
  await setRadixHex(page);
  await reconnectAsActiveSheet(page);
  await setRowAddress(page, "0000");
  await readRow(page);
  await expect(dataCell()).toHaveText("1", {
    timeout: CONNECTED_TIMEOUT,
  });
  await writeRow(page, "0");
  await expect(okDot()).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await readRow(page);
  await expect(dataCell()).toHaveText("0", {
    timeout: CONNECTED_TIMEOUT,
  });

  // 离散输入表（只读）：FC02 读 input1（配置预置 1）→ "0001"。
  await addBasicSheet(page, "Discrete Inputs (02H)");
  await setRadixHex(page);
  await reconnectAsActiveSheet(page);
  await setRowAddress(page, "0001");
  await readRow(page);
  await expect(dataCell()).toHaveText("0001", {
    timeout: CONNECTED_TIMEOUT,
  });

  // 输入寄存器表（只读）：FC04 读 inputReg2（配置预置 0x1234）→ "1234"。
  await addBasicSheet(page, "Input Registers (04H)");
  await setRadixHex(page);
  await reconnectAsActiveSheet(page);
  await setRowAddress(page, "0002");
  await readRow(page);
  await expect(dataCell()).toHaveText("1234", {
    timeout: CONNECTED_TIMEOUT,
  });

  // 自定义功能码表（ADR-043 E-4）：FC65 读保持寄存器 1（此前 FC10 写 0x12AB）→ "12AB"；
  // FC66 写 3=0xABCD → 回执；并用通信日志断言帧字节（FC65/FC66 与 FC03/FC10 同构，须靠帧区分）。
  await addBasicSheet(page, "Custom FC 65H/66H (example plugin)");
  await setRadixHex(page);
  await reconnectAsActiveSheet(page);
  await setRowAddress(page, "0001");
  await readRow(page);
  await expect(dataCell()).toHaveText("12AB", {
    timeout: CONNECTED_TIMEOUT,
  });
  await setRowAddress(page, "0003");
  await writeRow(page, "ABCD");
  await expect(okDot()).toBeVisible({ timeout: CONNECTED_TIMEOUT });

  // 通信日志：清空后重建目标帧（FC65 读 + FC66 写），断言函数码字节。
  // Listy 虚拟列表只渲染视口内行：最早帧（FC65 读请求）可能被挤出，先滚到顶部断言
  // 最早帧，再滚回底部断言最新帧（与既有「通信日志」用例一致，2026-08-26 real e2e 修复）。
  await page.getByRole("tab", { name: "Comm Log" }).click();
  await page.getByRole("button", { name: /Clear/i }).click();
  await setRowAddress(page, "0001");
  await readRow(page);
  await setRowAddress(page, "0003");
  await writeRow(page, "ABCD");
  await page.waitForTimeout(300);
  const list = page.locator(".comm-log .ant-listy-holder");
  await list.evaluate((el) => {
    (el as HTMLElement).scrollTop = 0;
  });
  await page.waitForTimeout(300);
  await expect(list).toContainText("01 65 00 01 00 01", { timeout: 5000 });
  await list.evaluate((el) => {
    (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
  });
  await page.waitForTimeout(300);
  await expect(list).toContainText("01 66 00 03 00 01", { timeout: 5000 });

  // 恢复保持寄存器表（Sheet 1）连接，避免后续「断开连接/重连」用例以自定义功能码协议重连。
  await page
    .getByRole("tab", { name: "Sheet 1" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await reconnectAsActiveSheet(page);
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
  // 按 Port Form.Item 限定定位端口下拉（连接对象配置分组已移除，ADR-034）。
  await modal
    .locator(".ant-form-item")
    .filter({ hasText: "Port" })
    .locator(".ant-select")
    .first()
    .click();
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
