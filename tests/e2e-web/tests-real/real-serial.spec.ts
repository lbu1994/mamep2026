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
import {
  chromium,
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const BASE_URL = "http://localhost:5173/";
const LOCAL_STORAGE_KEY = "mamep:real-serial-port";
const CONNECTED_TIMEOUT = 15_000;
/** 仓库根目录（本文件位于 tests/e2e-web/tests-real/）。 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
/**
 * ASCII 字符串区（从站保持寄存器 0x0010–0x001F，16 寄存器 = 32 字符）。
 * 期望文本直接由从站配置解码得出（`scripts/modbus-slave/modbus-slave.config.json`
 * 为唯一事实源，与从站自测 / README 一致，测试内不硬编码字符串）。
 */
function asciiStringRegion(): {
  start: number;
  registerCount: number;
  text: string;
} {
  const start = 0x0010;
  const registerCount = 16;
  const config = JSON.parse(
    readFileSync(
      path.join(
        REPO_ROOT,
        "scripts",
        "modbus-slave",
        "modbus-slave.config.json",
      ),
      "utf8",
    ),
  ) as { registers: Record<string, number> };
  let text = "";
  for (let i = 0; i < registerCount; i += 1) {
    const value = Number(config.registers[String(start + i)] ?? 0) & 0xffff;
    text += String.fromCharCode((value >> 8) & 0xff, value & 0xff);
  }
  return { start, registerCount, text };
}

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

/**
 * 把 RTU 超时 Select 设为固定档位。真实端口 e2e 稳定连接：应用默认超时已改为 50ms
 * （2026-09-06），对 com0com 虚拟串口偏紧，测试连接显式设为 100ms（应用默认维持 50ms）。
 * 2026-09-16 增补长档位后键入 "100" 会同时匹配 "100 ms" 与 "1000 ms"，Enter 落点不保证 →
 * 改为「键入收窄列表（antd 下拉为虚拟列表）+ 精确点选 <值> ms」。
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
  await p.keyboard.press("Control+a");
  await p.keyboard.type(String(timeoutMs));
  // 锚定正则只命中目标档位（避免前缀匹配到 "1000 ms"）。
  await p
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: new RegExp(`^${timeoutMs} ms$`) })
    .click();
  await expect(select).toHaveText(new RegExp(`^${timeoutMs} ms$`));
}

/** 首行填入地址（HEX 4 位）并提交。 */
async function setRowAddress(p: Page, addressHex: string): Promise<void> {
  const cell = p.getByLabel("Address", { exact: true }).first();
  await cell.click();
  // 等待进入编辑态：click 触发 React 重渲染渲染出 input（生产构建高负载下可能延迟，
  // 且前序读/写操作的行重渲染尚未 settle 时点击可能命中旧节点）。toBeEditable 自动
  // 重试直到 input 出现，比裸 waitForTimeout 可靠（2026-08-26 real e2e 竞态）。
  const input = p.getByLabel("Address", { exact: true }).first();
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
  await p
    .getByRole("button", { name: "Read", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

/** 把首行 Type（进制列）切到指定选项（antd Select 选项按 title 定位）。 */
async function setRowType(p: Page, optionTitle: string): Promise<void> {
  await p.getByLabel("Type").first().click();
  await p
    .locator(`.ant-select-dropdown:visible [title='${optionTitle}']`)
    .click();
}

/** 切换工具栏「写后回读」配置选项（OFF / ON / ON 100 ms / …，2026-08-26）。 */
async function setWriteVerify(p: Page, optionText: string): Promise<void> {
  await p.getByLabel("Write verification").click();
  await p
    .locator(".ant-select-item-option")
    .filter({ hasText: new RegExp(`^${optionText}$`) })
    .first()
    .click();
  // 确认选中值：antd v6 单选选中文本渲染在 Select 内 .ant-select-content
  // （combobox input 的 value 恒为空），故断言包裹容器 .table-toolbar__verify
  // 包含所选 label（2026-08-26 real e2e 修复）。
  await expect(p.locator(".table-toolbar__verify")).toContainText(optionText, {
    timeout: 5000,
  });
}

/** 首行填 Data（HEX）并点击 Write。 */
async function writeRow(p: Page, valueHex: string): Promise<void> {
  const cell = p.getByLabel("Data").first();
  await cell.click();
  // 同 setRowAddress：等待编辑态 + pressSequentially 逐字符输入（fill 偶发不触发
  // React onChange 致提交短路）+ toHaveValue 确认受控值同步后再 Enter。
  const data = p.getByLabel("Data").first();
  await expect(data).toBeEditable({ timeout: 5000 });
  await data.fill("");
  await data.pressSequentially(valueHex, { delay: 10 });
  await expect(data).toHaveValue(valueHex);
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
  page.on("pageerror", (err) =>
    consoleErrors.push(`PAGEERROR: ${String(err)}`),
  );

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
  await modal.getByRole("button", { name: /Select serial port/i }).click();
  await modal.getByText(/^USB /).waitFor({ timeout: 120_000 });
  const label = (await modal.getByText(/^USB /).first().innerText()).trim();
  console.log(`[real-serial] 已选择串口: ${label}`);

  // 记录到 localStorage（后续运行对照 + 运行内复用）。
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [
    LOCAL_STORAGE_KEY,
    JSON.stringify({ portId: label, label, selectedAt: Date.now() }),
  ] as const);

  // 真实端口稳定连接：RTU 超时手动输入设 Select 上限 100ms。
  await setRtuTimeoutSelect(page, modal, 100);

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
  ).toHaveAttribute("aria-label", "The device returned a Modbus exception.");
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
  // 写忽略区（0x0900–0x090f）：写入返回正常成功帧，但**不实际写入**——回读仍为旧值 0。
  // Verify=ON（immediate，本表默认）：写入后立即 FC03 回读 → 值不一致（写 1234 / 读 0000）
  // → 失败点（红点），且 Data 列被回读值覆盖（§15.1），显示 0000 而非写入的 1234。
  await setRowAddress(page, "0900");
  await writeRow(page, "1234");
  // 写入成功但回读不一致 → 失败态（红点）。
  await expect(
    page.locator(".register-table__status-dot--error").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  // 关键断言：Data 列显示的是回读值（0000），而不是写入值（1234）。
  await expect(page.getByLabel("Data").first()).toHaveText("0000", {
    timeout: CONNECTED_TIMEOUT,
  });
  await expect(page.getByLabel("Data").first()).not.toHaveText("1234");
  // 手动读回仍为 0000（设备未落盘）。
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("0000", {
    timeout: CONNECTED_TIMEOUT,
  });
});

test("写后回读 Verify=OFF：写忽略区 0x0900 写入后 Data 保持写入值 1234（不回读）", async () => {
  // Verify=OFF：写入成功即成功态（绿点），不回读；Data 保持用户输入值 1234。
  await setWriteVerify(page, "OFF");
  await setRowAddress(page, "0900");
  await writeRow(page, "1234");
  await expect(
    page.locator(".register-table__status-dot--success").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  await expect(page.getByLabel("Data").first()).toHaveText("1234", {
    timeout: CONNECTED_TIMEOUT,
  });
  // 手动读回仍为 0000（设备未落盘）。
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText("0000", {
    timeout: CONNECTED_TIMEOUT,
  });
  // 恢复默认 ON（后续测试按默认行为执行）。
  await setWriteVerify(page, "ON");
});

test("ASCII 字符串区：FC03 连续读 16 寄存器（0x0010–0x001F）+ Type=String → Data 显示字符串", async () => {
  // 从站保持寄存器 0x0010–0x001F 预置 32 字符 ASCII（16 寄存器 × 2 字符，高字节在前）；
  // 该区间未命中任何规则 → 回退正常行为。应用侧用范围行 + Type=String 一次 FC03 读回，
  // Data 列直接显示可读 ASCII 字符串（ADR-030 字符串语义）。
  const ascii = asciiStringRegion();
  await setRowAddress(page, "0010-001F");
  await setRowType(page, "String");
  await readRow(page);
  await expect(page.getByLabel("Data").first()).toHaveText(ascii.text, {
    timeout: CONNECTED_TIMEOUT,
  });
  await expect(
    page.locator(".register-table__status-dot--success").first(),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
});

test("断开连接 → 状态复位为断开（连接按钮恢复 Connect 态）", async () => {
  await page.getByRole("button", { name: /Disconnect/i }).click();
  // Header 连接 UI 已于 2026-09-06 整合为单一多功能按钮（状态点 + Connect/Disconnect 合一），
  // 不再单独渲染 "Offline" 文本；改用按钮 data-conn-state 判定断开态（宽/窄窗口均适用）。
  await expect(
    page.locator(".connection-cluster__button[data-conn-state='disconnected']"),
  ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
});

test("无 console 错误（含 CSP 违规、antd 弃用）", async () => {
  expect(
    consoleErrors,
    `console/page errors: ${consoleErrors.join(" | ")}`,
  ).toEqual([]);
});
