/**
 * VSCode 端「真实 Modbus TCP」e2e（UI 级，本地回环真实 net 端口）。
 *
 * vscode-test-playwright 驱动真实 VS Code：主面板（生产 webview）→ webview iframe
 * 内共享 UI → Connection Settings 切 Modbus TCP → 按 config/connections.json
 * tcp-local-slave（host/port/unitId，本 spec 读取不硬编码）填表 → Extension Host
 * VscodeSessionHost.connectTcp 真实 TCP 连接真实 TCP 从站（runner 拉起的
 * scripts/modbus-slave/modbus-tcp-slave.mjs）。
 *
 * 门控：仅 MAMEP_REAL=1（由 scripts/e2e-real.mjs 设置）时运行；不设 MAMEP_FAKE_TCP。
 * 运行方式：pnpm test:e2e:vscode:real（runner 预检 + 拉起 TCP 从站 + build:vscode）。
 *
 * 场景：连接 Online → FC03 读 / FC10 写 + 读回 → 写值门控 → 异常区 → no-response
 * 超时 → 边界 → 扩展（分片/延迟）→ 通信日志 → 断开/重连 → 无 console 错误。
 */
import { expect, test } from "vscode-test-playwright";
import type { Frame, Locator, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const CONNECTED_TIMEOUT = 20_000;

// 门控：真实端口测试需显式开启（MAMEP_REAL=1，由 scripts/e2e-real.mjs 设置）。
test.skip(
  process.env.MAMEP_REAL !== "1",
  "真实端口测试需显式开启（MAMEP_REAL=1，由 pnpm test:e2e:vscode:real 触发）",
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

/**
 * 等待承载共享 UI 的 webview 内容 frame 出现。
 * VSCode 1.134 webview 为两层：容器 frame（vscode-webview://。/index.html）内嵌
 * 内容 frame（vscode-webview://。/fake.html，承载 #root/.ant-app 共享 UI）。
 * 按 url 前缀会误匹配容器 frame，须定位含 UI 的内容 frame（实测）。
 */
async function waitForWebviewFrame(page: Page): Promise<Frame> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const f of page.frames()) {
      if (!f.url().startsWith("vscode-webview://")) continue;
      try {
        const hasUi = await f.evaluate(
          () => document.querySelector("#root .ant-app, .ant-layout") !== null,
        );
        if (hasUi) return f;
      } catch {
        // frame 可能尚未就绪，轮询重试。
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    "webview UI frame 未出现（确认已 pnpm build:vscode 且 webview 已加载共享 UI）",
  );
}

/**
 * VSCode webview 是否处于移动布局（视口 < 1024px）。
 *
 * VS Code 面板为窄窗口（实测两侧栏同时展开时编辑区 < 1024px），共享 UI 因此走移动分支：
 * 底部面板 → 底部抽屉（Header「Open panel」入口）、工具栏次要控件 → 「更多」面板。
 * 桌面布局下下列 helper 自动退化为 no-op，两套布局共用同一份用例（不依赖窗口宽度）。
 */
async function isMobileLayout(frame: Frame): Promise<boolean> {
  return await frame.evaluate(
    () => window.matchMedia("(max-width: 1023px)").matches,
  );
}

/** 移动布局下的底部面板抽屉内容（antd v6 Drawer：className 落在 .ant-drawer-section）。 */
async function openBottomPanel(frame: Frame): Promise<void> {
  if (!(await isMobileLayout(frame))) return;
  await frame.getByRole("button", { name: "Open panel" }).click();
  await expect(frame.locator(".bottom-panel--drawer")).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * 收起底部面板抽屉（移动布局）；桌面布局为 no-op。
 *
 * 抽屉带遮罩，会拦截表格交互，故清空日志后必须先收起再操作表格。
 * 优先点抽屉自带关闭按钮（closable 默认开启），不可用时回退 Esc（antd keyboard 默认开启）。
 */
async function closeBottomPanel(frame: Frame): Promise<void> {
  if (!(await isMobileLayout(frame))) return;
  const closeButton = frame.locator(
    ".ant-drawer:has(.mamep-mobile-drawer--panel) .ant-drawer-close",
  );
  if (await closeButton.isVisible()) {
    await closeButton.click();
  } else {
    await frame.page().keyboard.press("Escape");
  }
  await expect(frame.locator(".bottom-panel--drawer")).toBeHidden({
    timeout: 10_000,
  });
}

/** 展开底部面板（移动布局）并切到通信日志页签；桌面布局等价于点页签。 */
async function openCommLog(frame: Frame): Promise<void> {
  await openBottomPanel(frame);
  await frame.getByRole("tab", { name: "Comm Log" }).click();
}

/**
 * 将当前表 Register 地址列进制切到 HEX（与从站规则地址一致）。
 *
 * 移动布局：地址进制收在工具栏「更多」面板内 —— 先展开、点选后收起（浮层会遮挡表格右侧
 * 的 Read/Write 按钮）。桌面布局：直接点击工具栏内 Segmented。
 */
async function setRadixHex(frame: Frame): Promise<void> {
  const mobile = await isMobileLayout(frame);
  const moreButton = frame.getByRole("button", {
    name: "More toolbar actions",
  });
  const morePanel = frame.locator(".table-toolbar__more");
  if (mobile) {
    await moreButton.click();
    await expect(morePanel).toBeVisible({ timeout: 5000 });
  }
  const radix = frame.locator(".table-toolbar__radix");
  await radix.locator(".ant-segmented-item", { hasText: "HEX" }).click();
  await expect(radix.locator(".ant-segmented-item-selected")).toHaveText(
    "HEX",
    { timeout: 5000 },
  );
  if (mobile) {
    await moreButton.click();
    await expect(morePanel).toBeHidden({ timeout: 5000 });
  }
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
async function setRowAddress(frame: Frame, addressHex: string): Promise<void> {
  const cell = frame.getByLabel("Address", { exact: true }).first();
  await cell.click();
  // 等待进入编辑态（click 触发 React 重渲染渲染出 input；高负载下可能延迟）。
  const input = frame.getByLabel("Address", { exact: true }).first();
  await expect(input).toBeEditable({ timeout: 5000 });
  // Playwright fill() 用原生 value setter 设置 DOM 值，偶发不触发 React onChange
  // （draftRef 未同步但 DOM value 已变，toHaveValue 假通过，Enter 提交读到旧 draft 而
  // 短路）。使用 fill("")+pressSequentially 逐字符输入（真实键盘事件，onChange 必然触发），
  // toHaveValue 确认受控值同步后再 Enter。
  await input.fill("");
  await input.pressSequentially(addressHex, { delay: 10 });
  await expect(input).toHaveValue(addressHex);
  await input.press("Enter");
}

/** 首行点击 Read。 */
async function readRow(frame: Frame): Promise<void> {
  await frame
    .getByRole("button", { name: "Read", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

/** 首行填 Data（HEX）并点击 Write。 */
async function writeRow(frame: Frame, valueHex: string): Promise<void> {
  const cell = frame.getByLabel("Data").first();
  await cell.click();
  // 同 setRowAddress：等待编辑态 + pressSequentially 逐字符输入 + toHaveValue 同步。
  const data = frame.getByLabel("Data").first();
  await expect(data).toBeEditable({ timeout: 5000 });
  await data.fill("");
  await data.pressSequentially(valueHex, { delay: 10 });
  await expect(data).toHaveValue(valueHex);
  await data.press("Enter");
  await frame
    .getByRole("button", { name: "Write", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

/** 显式切换当前表的写后回读配置。 */
async function setWriteVerify(
  frame: Frame,
  optionText: string,
): Promise<void> {
  const verify = frame.locator(".table-toolbar__verify");
  await verify.getByLabel("Write verification").click();
  await frame
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: new RegExp(`^${optionText}$`) })
    .first()
    .click();
  await expect(verify).toContainText(optionText, { timeout: 5000 });
}

test("真实 Modbus TCP（UI 级）：连接 + 全场景矩阵", async ({
  workbox,
  evaluateInVSCode,
}) => {
  const consoleErrors: string[] = [];
  workbox.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // VS Code 自身基础设施（扩展市场查询 / 网络资源加载）的报错与 webview 应用无关，
    // 且为网络环境性 flaky，不纳入「无 console 错误」断言；只统计来自共享 UI webview
    // （vscode-webview://）的 console 错误。
    const sourceUrl = msg.location()?.url ?? "";
    if (!sourceUrl.startsWith("vscode-webview://")) return;
    consoleErrors.push(`CONSOLE: ${msg.text()}`);
  });
  workbox.on("pageerror", (err) =>
    consoleErrors.push(`PAGEERROR: ${String(err)}`),
  );

  await workbox.setViewportSize({ width: 1600, height: 900 });

  await evaluateInVSCode((vscode) =>
    vscode.commands.executeCommand("mamep2026.openMainPanel"),
  );
  const frame = await waitForWebviewFrame(workbox);

  await test.step("TCP 连接：按 config tcp-local-slave 填 host/port/unitId → Online", async () => {
    const modal = frame.locator(".ant-modal-container:visible");
    await modal.waitFor({ timeout: 30_000 });

    // 切到 Modbus TCP（Segmented）。
    await modal
      .locator(".ant-segmented-item")
      .filter({ hasText: "Modbus TCP" })
      .click();

    // host（占位符 192.168.1.10 的 Input）。
    const tcp = tcpConfig();
    await modal.getByPlaceholder("192.168.1.10").fill(tcp.host);
    await fillNumber(modal, "TCP Port", String(tcp.port));
    await fillNumber(modal, "Unit ID", String(tcp.unitId));

    await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
    // VSCode webview 为窄窗口，Header 连接按钮文字隐藏（data-conn-state 判定，宽/窄均适用）。
    await expect(
      frame.locator(".connection-cluster__button[data-conn-state='connected']"),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
    await expect(frame.locator(".ant-modal-container:visible")).toHaveCount(0);

    await setRadixHex(frame);
  });

  await test.step("FC03 读正常区 0x0000 → 0x04D2（从站初始值 1234）", async () => {
    await setRowAddress(frame, "0000");
    await readRow(frame);
    await expect(frame.getByLabel("Data").first()).toHaveText("04D2", {
      timeout: CONNECTED_TIMEOUT,
    });
  });

  await test.step("FC0x10 写正常区 0x0001=0x12AB + 读回验证", async () => {
    await setRowAddress(frame, "0001");
    await writeRow(frame, "12AB");
    await expect(
      frame.locator(".register-table__status-dot--success").first(),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
    await readRow(frame);
    await expect(frame.getByLabel("Data").first()).toHaveText("12AB", {
      timeout: CONNECTED_TIMEOUT,
    });
  });

  await test.step("写值门控 0x0400：写 0x8000 被拒（异常 0x03），写 0x1234 成功", async () => {
    await setRowAddress(frame, "0400");
    await writeRow(frame, "8000");
    await expect(
      frame.locator(".register-table__status-dot--error").first(),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
    await expect(
      frame.locator(".register-table__status-dot").first(),
    ).toHaveAttribute("aria-label", "The device returned a Modbus exception.");
    await writeRow(frame, "1234");
    await expect(
      frame.locator(".register-table__status-dot--success").first(),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
    await readRow(frame);
    await expect(frame.getByLabel("Data").first()).toHaveText("1234", {
      timeout: CONNECTED_TIMEOUT,
    });
  });

  await test.step("异常区：只读/只写/不存在/不支持功能", async () => {
    await setRowAddress(frame, "0100");
    await writeRow(frame, "0001");
    await expect(
      frame.locator(".register-table__status-dot--error").first(),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });

    await setRowAddress(frame, "0200");
    await readRow(frame);
    await expect(
      frame.locator(".register-table__status-dot--error").first(),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });

    await setRowAddress(frame, "0300");
    await readRow(frame);
    await expect(
      frame.locator(".register-table__status-dot--error").first(),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });

    await setRowAddress(frame, "0500");
    await readRow(frame);
    await expect(
      frame.locator(".register-table__status-dot--error").first(),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  });

  await test.step("no-response 0x0600：读超时错误，且不破坏后续请求", async () => {
    await setRowAddress(frame, "0600");
    await readRow(frame);
    await expect(
      frame.locator(".register-table__status-dot--error").first(),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
    await expect(
      frame.locator(".register-table__status-dot").first(),
    ).toHaveAttribute(
      "aria-label",
      "No response from the device within the timeout.",
    );
    await setRowAddress(frame, "0000");
    await readRow(frame);
    await expect(frame.getByLabel("Data").first()).toHaveText("04D2", {
      timeout: CONNECTED_TIMEOUT,
    });
  });

  await test.step("边界：地址 0 与最大地址 0xFFFF（规则外回退正常）", async () => {
    await setRowAddress(frame, "0000");
    await readRow(frame);
    await expect(frame.getByLabel("Data").first()).toHaveText("04D2", {
      timeout: CONNECTED_TIMEOUT,
    });
    await setRowAddress(frame, "FFFF");
    await readRow(frame);
    await expect(frame.getByLabel("Data").first()).toHaveText("0000", {
      timeout: CONNECTED_TIMEOUT,
    });
    await writeRow(frame, "1234");
    await expect(
      frame.locator(".register-table__status-dot--success").first(),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
    await readRow(frame);
    await expect(frame.getByLabel("Data").first()).toHaveText("1234", {
      timeout: CONNECTED_TIMEOUT,
    });
  });

  await test.step("扩展：分片响应 0x0800 读写成功（半包/粘包组帧健壮性）", async () => {
    await setRowAddress(frame, "0800");
    await writeRow(frame, "1234");
    await expect(
      frame.locator(".register-table__status-dot--success").first(),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
    await readRow(frame);
    await expect(frame.getByLabel("Data").first()).toHaveText("1234", {
      timeout: CONNECTED_TIMEOUT,
    });
  });

  await test.step("扩展：延迟响应 0x0700 读超时（迟到丢弃），后续正常", async () => {
    await setRowAddress(frame, "0700");
    await readRow(frame);
    await expect(
      frame.locator(".register-table__status-dot--error").first(),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
    // 从站对 0x0700 的延迟响应（2500ms）落在主站超时窗口（requestTimeoutMs 50ms ×
    // retryCount+1 共 2 次）之后才到达；若此时立即发起新读，RTU 无 Transaction ID 会把
    // 迟到的 0x0700 响应当作新读的响应（真实串口时序竞态，会污染 0x0000 的新读；
    // 值 0000）。等待迟到响应在无活动请求时（pendingExchange 为空）到达并被丢弃，再读回
    // 正常区，验证「迟到丢弃」语义。
    await frame.waitForTimeout(800);
    await setRowAddress(frame, "0000");
    await readRow(frame);
    await expect(frame.getByLabel("Data").first()).toHaveText("04D2", {
      timeout: CONNECTED_TIMEOUT,
    });
  });

  await test.step("通信日志：请求/响应/异常帧字节", async () => {
    // Listy 虚拟列表只渲染视口内的行：共享会话下历史帧已被滚动挤出，
    // 清空后在测试内重建目标帧（写值门控异常 0x03、只读区异常 0x02、读 0x0000）。
    // 移动布局（窄窗口）：底部面板在带遮罩的抽屉内 → 先展开清空、收起抽屉再操作表格，
    // 生成目标帧后重新展开断言（抽屉开合不丢日志内容）。
    await openCommLog(frame);
    await frame.getByRole("button", { name: /Clear/i }).click();
    await closeBottomPanel(frame);
    await setRowAddress(frame, "0400");
    await writeRow(frame, "8000");
    await setRowAddress(frame, "0100");
    await writeRow(frame, "0001");
    await setRowAddress(frame, "0000");
    await readRow(frame);
    await expect(frame.getByLabel("Data").first()).toHaveText("04D2", {
      timeout: CONNECTED_TIMEOUT,
    });
    await frame.waitForTimeout(300);
    await openCommLog(frame);
    const list = frame.locator(".comm-log .ant-listy-holder");
    // Listy 虚拟列表默认停在底部（最新帧可见）；最早帧（写门控异常 01 90 03）可能被
    // 挤出视口（TCP 帧含 MBAP 头行更高，且延迟响应的迟到帧也会占用视口）。滚动到顶部
    // 让最早帧渲染后断言，再滚回底部断言最新帧。
    await list.evaluate((el) => {
      el.scrollTop = 0;
    });
    await frame.waitForTimeout(300);
    await expect(list).toContainText("01 90 03", { timeout: 5000 });
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await frame.waitForTimeout(300);
    await expect(list).toContainText("01 90 02", { timeout: 5000 });
    await expect(list).toContainText("01 03 00 00 00 01", { timeout: 5000 });
    await expect(list).toContainText("01 03 02 04 D2", { timeout: 5000 });
    // 收起抽屉（移动布局）：遮罩会拦截后续步骤的表格点击。
    await closeBottomPanel(frame);
  });

  await test.step("写后回读 Verify：默认 OFF，显式 ON 后写忽略区 0x0900 → Data 显示回读值 0000", async () => {
    // 写忽略区（0x0900–0x090f）：写入返回正常成功帧但不落盘——回读仍为旧值 0。
    // 新表默认 OFF；本用例显式 ON，写入后立即 FC03 回读 → 值不一致 → 失败点（红点），
    // Data 列被回读值覆盖（§15.1）显示 0000 而非写入的 1234。
    await expect(frame.locator(".table-toolbar__verify")).toContainText("OFF");
    await setWriteVerify(frame, "ON");
    await setRowAddress(frame, "0900");
    await writeRow(frame, "1234");
    await expect(
      frame.locator(".register-table__status-dot--error").first(),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
    await expect(frame.getByLabel("Data").first()).toHaveText("0000", {
      timeout: CONNECTED_TIMEOUT,
    });
    await expect(frame.getByLabel("Data").first()).not.toHaveText("1234");
    await readRow(frame);
    await expect(frame.getByLabel("Data").first()).toHaveText("0000", {
      timeout: CONNECTED_TIMEOUT,
    });
    await setWriteVerify(frame, "OFF");
  });

  await test.step("断开连接 → Offline，重连 → Online（稳定性）", async () => {
    await frame.getByRole("button", { name: /Disconnect/i }).click();
    // Header 连接按钮已整合，断开后显示 Connect 态、无 "Offline" 文本；以 data-conn-state 判定。
    await expect(
      frame.locator(
        ".connection-cluster__button[data-conn-state='disconnected']",
      ),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });

    // 重连：Connection Settings → 切 TCP → 重填（值仍来自 config）。
    await frame
      .getByRole("button", { name: "Connection" })
      .evaluate((el) => (el as HTMLElement).click());
    const modal = frame.locator(".ant-modal-container:visible");
    await modal.waitFor({ timeout: 10_000 });
    const tcp = tcpConfig();
    await modal
      .locator(".ant-segmented-item")
      .filter({ hasText: "Modbus TCP" })
      .click();
    await modal.getByPlaceholder("192.168.1.10").fill(tcp.host);
    await fillNumber(modal, "TCP Port", String(tcp.port));
    await fillNumber(modal, "Unit ID", String(tcp.unitId));
    await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
    await expect(
      frame.locator(".connection-cluster__button[data-conn-state='connected']"),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
  });

  await test.step("无 console 错误（含 CSP 违规、antd 弃用）", async () => {
    expect(
      consoleErrors,
      `console/page errors: ${consoleErrors.join(" | ")}`,
    ).toEqual([]);
  });
});
