/**
 * VSCode 端「真实串口」RTU e2e（UI 级，com0com COM4↔COM5 + Extension Host 真实 serialport）。
 *
 * 用 vscode-test-playwright 驱动真实 VS Code：打开主面板（生产 webview）→ webview
 * iframe（vscode-webview://）内驱动共享 UI → Connection Settings 串口下拉（serial-
 * enumerate RPC，无手势要求）→ 自动选择 config/connections.json rtu-com4-master 指定
 * 的串口 → Extension Host NodePlatformHost（RealSerialPortFactory）真实串口读写闭环。
 *
 * 门控：仅 MAMEP_REAL=1（由 scripts/e2e-real.mjs 设置）时运行；此时不设
 * MAMEP_FAKE_SERIAL/MAMEP_FAKE_TCP，走真实设备。
 * 运行方式：pnpm test:e2e:vscode:real（runner 预检 + 拉起 COM5 从站 + build:vscode）。
 *
 * 场景：连接 Online → FC03 读 / FC10 写 + 读回 → 写值门控 → 异常区 → no-response
 * 超时 → 边界 → 扩展（分片/延迟）→ 通信日志 → 断开/重连 → 无 console 错误。
 * 每次测试 = 一次 VS Code 启动（fixture 每测试新建），故整矩阵用单个测试 + test.step。
 */
import { expect, test } from "vscode-test-playwright";
import type { Frame, Locator, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { isKnownVSCodeWebviewShellPageError } from "./known-upstream-errors";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const CONNECTED_TIMEOUT = 20_000;

// 门控：真实端口测试需显式开启（MAMEP_REAL=1，由 scripts/e2e-real.mjs 设置）。
test.skip(
  process.env.MAMEP_REAL !== "1",
  "真实端口测试需显式开启（MAMEP_REAL=1，由 pnpm test:e2e:vscode:real 触发）",
);

/** 读取 config/connections.json 的 rtu-com4-master（连接参数唯一事实源，不硬编码）。 */
function rtuConfig(): { port: string; baudRate: number; slaveAddress: number } {
  const raw = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "config", "connections.json"), "utf8"),
  );
  const conn = raw.connections.find(
    (c: { id: string }) => c.id === "rtu-com4-master",
  );
  if (conn === undefined)
    throw new Error("config/connections.json 缺少 rtu-com4-master");
  return {
    port: conn.port,
    baudRate: conn.baudRate,
    slaveAddress: conn.slaveAddress,
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
 * 底部面板 → 底部抽屉（Header「Open panel」入口）、低频表格配置 → Table settings。
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
 * 抽屉带遮罩，会拦截表格交互，故断链（清空日志）后必须先收起再操作表格。
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

/** 打开当前表的 Table settings 面板。 */
async function openTableSettings(frame: Frame) {
  const trigger = frame
    .getByRole("button", { name: "Table settings", exact: true })
    .first();
  const panel = frame.locator(".table-toolbar__settings:visible").first();
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible({ timeout: 5000 });
  return panel;
}

/** 将当前表 Register 地址列进制切到 HEX（与从站规则地址一致）。 */
async function setRadixHex(frame: Frame): Promise<void> {
  const panel = await openTableSettings(frame);
  const radix = panel.locator(".table-toolbar__radix");
  await radix.locator(".ant-segmented-item", { hasText: "HEX" }).click();
  await expect(radix.locator(".ant-segmented-item-selected")).toHaveText(
    "HEX",
    { timeout: 5000 },
  );
  await frame
    .getByRole("button", { name: "Table settings", exact: true })
    .click();
  await expect(panel).toBeHidden({ timeout: 5000 });
}

/** 首行填入地址（HEX 4 位）并提交。 */
async function setRowAddress(frame: Frame, addressHex: string): Promise<void> {
  const table = frame.locator(".register-table-tabs .ant-tabs-content-active");
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const cell = table.locator('[data-register-cell="address"]').first();
      await cell.click();
      const input = frame
        .locator('input[data-register-cell="address"]')
        .first();
      await expect(input).toBeEditable({ timeout: 5000 });
      await input.fill("");
      await input.pressSequentially(addressHex, { delay: 10 });
      await expect(input).toHaveValue(addressHex);
      await input.press("Enter");
      await expect(
        frame.locator('input[data-register-cell="address"]'),
      ).toHaveCount(0);
      await expect(
        table.locator('[data-register-cell="address"]').first(),
      ).toHaveAttribute("data-committed-value", addressHex);
      return;
    } catch (error) {
      lastError = error;
      await frame.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    }
  }
  throw lastError;
}

/** 首行点击 Read。 */
async function readRow(frame: Frame): Promise<void> {
  const button = frame
    .locator(".register-table-tabs .ant-tabs-content-active")
    .getByRole("button", { name: /^Read row / })
    .first();
  await expect(button).toBeEnabled({ timeout: 5000 });
  await button.click();
}

/** 首行填 Data（HEX）并点击 Write。 */
async function writeRow(frame: Frame, valueHex: string): Promise<void> {
  const table = frame.locator(".register-table-tabs .ant-tabs-content-active");
  const cell = table.locator('[data-register-cell="data"]').first();
  await cell.click();
  // 同 setRowAddress：等待编辑态 + pressSequentially 逐字符输入 + toHaveValue 同步。
  const data = frame.locator('input[data-register-cell="data"]').first();
  await expect(data).toBeEditable({ timeout: 5000 });
  await data.fill("");
  await data.pressSequentially(valueHex, { delay: 10 });
  await expect(data).toHaveValue(valueHex);
  await data.press("Enter");
  await expect(frame.locator('input[data-register-cell="data"]')).toHaveCount(
    0,
  );
  await expect(
    table.locator('[data-register-cell="data"]').first(),
  ).toHaveAttribute("data-committed-value", valueHex);
  const writeButton = table
    .getByRole("button", { name: /^Write row / })
    .first();
  await expect(writeButton).toBeEnabled({ timeout: 5000 });
  await writeButton.click();
}

/** 显式切换当前表的写后回读配置。 */
async function setWriteVerify(frame: Frame, optionText: string): Promise<void> {
  const panel = await openTableSettings(frame);
  const verify = panel.locator(".table-toolbar__verify");
  const control = verify.getByLabel("Write verification");
  await expect(control).toBeVisible();
  if ((await control.evaluate((el) => el.tagName)) === "SELECT") {
    await control.selectOption({ label: optionText });
  } else {
    await control.click({ force: true });
    await frame
      .locator(".ant-select-dropdown:visible .ant-select-item-option")
      .filter({ hasText: new RegExp(`^${optionText}$`) })
      .first()
      .evaluate((el) => (el as HTMLElement).click());
  }
  await expect(verify).toContainText(optionText, { timeout: 5000 });
  await frame
    .getByRole("button", { name: "Close table settings", exact: true })
    .click();
  await expect(panel).toBeHidden({ timeout: 5000 });
}

/**
 * 把 RTU 超时 Select 设为固定档位。真实端口 e2e 稳定连接：应用默认超时为 50ms
 * 对 com0com 虚拟串口偏紧，测试连接显式设为 100ms（应用默认维持 50ms）。
 *  增补长档位后键入 "100" 会同时匹配 "100 ms" 与 "1000 ms"，Enter 落点不保证 →
 * 使用「键入收窄列表（antd 下拉为虚拟列表）+ 精确点选 <值> ms」。
 *  两处修正：
 * 1. **下拉必须用 `frame` 作用域定位**（不是 `frame.page()`）——VSCode 是「窗口 → 容器 iframe →
 *    内容 iframe」两层嵌套，页面级定位器只在顶层文档查找，永远命中不到 webview 内的下拉
 *    （改成精确点选时引入，浏览器 / Electron 无嵌套故一直绿，VSCode 一直超时）。
 * 2. 收窄方式用**直接 fill 搜索框**（元素级事件），不依赖窗口 / iframe 键盘焦点。
 */
async function setRtuTimeoutSelect(
  frame: Frame,
  modal: Locator,
  timeoutMs: number,
): Promise<void> {
  const select = modal
    .locator(".ant-form-item")
    .filter({ hasText: "Timeout" })
    .locator(".ant-select")
    .first();
  await select.click();
  // 直接写入 Select 的搜索框（focus + input 事件），收窄下拉列表。
  await select.locator("input").fill(String(timeoutMs));
  // 锚定正则只命中目标档位（避免前缀匹配到 "1000 ms"）。
  const option = frame
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: new RegExp(`^${timeoutMs} ms$`) });
  await option.waitFor({ state: "visible", timeout: 10_000 });
  await option.click();
  await expect(select).toHaveText(new RegExp(`^${timeoutMs} ms$`));
}

test("真实串口 RTU（UI 级）：连接 + 全场景矩阵", async ({
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
  workbox.on("pageerror", (err) => {
    const stack = err.stack ?? "";
    if (!stack.includes("vscode-webview://")) return;
    if (isKnownVSCodeWebviewShellPageError(err)) return;
    consoleErrors.push(`PAGEERROR: ${String(err)}\n${stack}`);
  });

  // 桌面布局（避免窄窗口响应式分支）。
  await workbox.setViewportSize({ width: 1600, height: 900 });

  // 打开主面板。
  await evaluateInVSCode((vscode) =>
    vscode.commands.executeCommand("mamep2026.openMainPanel"),
  );
  const frame = await waitForWebviewFrame(workbox);

  await test.step("连接：自动选择 COM4（config rtu-com4-master）→ Online", async () => {
    // 非 mock 启动自动弹出 Connection Settings（webview 内）。
    const modal = frame.locator(".ant-modal-container:visible");
    await modal.waitFor({ timeout: 30_000 });

    // 打开串口下拉（serial-enumerate RPC 枚举真实端口）→ 选择配置指定串口。
    // 按 Port Form.Item 限定定位端口下拉（连接对象配置分组已移除）。
    const rtu = rtuConfig();
    await modal
      .locator(".ant-form-item")
      .filter({ hasText: "Port" })
      .locator(".ant-select")
      .first()
      .click();
    const option = frame
      .locator(".ant-select-dropdown:visible .ant-select-item-option")
      .filter({ hasText: rtu.port });
    await option.waitFor({ state: "visible", timeout: 15_000 });
    await option.click();
    // 真实端口稳定连接：RTU 超时手动输入设 Select 上限 100ms。
    await setRtuTimeoutSelect(frame, modal, 100);

    // Connect → Online，弹窗关闭。
    await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
    // VSCode webview 为窄窗口，Header 连接按钮文字隐藏（data-conn-state 判定，宽/窄均适用）。
    await expect(
      frame.locator(".connection-cluster__button[data-conn-state='connected']"),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
    await expect(frame.locator(".ant-modal-container:visible")).toHaveCount(0);

    // 地址进制切到 HEX，便于按从站规则地址操作。
    await setRadixHex(frame);
  });

  await test.step("FC03 读正常区 0x0000 → 0x04D2（从站初始值 1234）", async () => {
    await setRowAddress(frame, "0000");
    await readRow(frame);
    await expect(
      frame.locator('[data-register-cell="data"]').first(),
    ).toHaveText("04D2", {
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
    await expect(
      frame.locator('[data-register-cell="data"]').first(),
    ).toHaveText("12AB", {
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
    await expect(
      frame.locator('[data-register-cell="data"]').first(),
    ).toHaveText("1234", {
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
    await expect(
      frame.locator('[data-register-cell="data"]').first(),
    ).toHaveText("04D2", {
      timeout: CONNECTED_TIMEOUT,
    });
  });

  await test.step("边界：地址 0 与最大地址 0xFFFF（规则外回退正常）", async () => {
    await setRowAddress(frame, "0000");
    await readRow(frame);
    await expect(
      frame.locator('[data-register-cell="data"]').first(),
    ).toHaveText("04D2", {
      timeout: CONNECTED_TIMEOUT,
    });
    await setRowAddress(frame, "FFFF");
    await readRow(frame);
    await expect(
      frame.locator('[data-register-cell="data"]').first(),
    ).toHaveText("0000", {
      timeout: CONNECTED_TIMEOUT,
    });
    await writeRow(frame, "1234");
    await expect(
      frame.locator(".register-table__status-dot--success").first(),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
    await readRow(frame);
    await expect(
      frame.locator('[data-register-cell="data"]').first(),
    ).toHaveText("1234", {
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
    await expect(
      frame.locator('[data-register-cell="data"]').first(),
    ).toHaveText("1234", {
      timeout: CONNECTED_TIMEOUT,
    });
  });

  await test.step("扩展：延迟响应 0x0700 读超时（迟到丢弃），后续正常", async () => {
    await setRowAddress(frame, "0700");
    await readRow(frame);
    // 前一阶段可能已经留下错误点；从本次点击起完整覆盖两帧迟到响应窗口，
    // 再确认本次超时并发出后续正常读，避免把旧错误状态当成新请求已经结束。
    await frame.waitForTimeout(3000);
    await expect(
      frame.locator(".register-table__status-dot--error").first(),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
    // 从站对 0x0700 的延迟响应（2500ms）落在主站超时窗口（requestTimeoutMs 50ms ×
    // retryCount+1 共 2 次 ≈ 100ms）之后才到达；若此时立即发起新读，RTU 无 Transaction ID
    // 会把迟到的 0x0700 响应当作新读的响应，污染 0x0000 的新读。两次重试
    // （attempt1/attempt2）均在 ~100ms 内超时，两帧迟到响应各在其请求
    // 后 ~2500ms 到达（~2500 / ~2550ms）。等两帧迟到响应都在无活动请求时（pendingExchange
    // 为空）到达并被丢弃，再读回正常区（默认超时改 50ms，等待 3000ms 覆盖）。
    await setRowAddress(frame, "0000");
    await readRow(frame);
    await expect(
      frame.locator('[data-register-cell="data"]').first(),
    ).toHaveText("04D2", {
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
    await expect(
      frame.locator('[data-register-cell="data"]').first(),
    ).toHaveText("04D2", {
      timeout: CONNECTED_TIMEOUT,
    });
    await frame.waitForTimeout(300);
    await openCommLog(frame);
    const list = frame.locator(".comm-log .ant-listy-holder");
    // Listy 虚拟列表默认停在底部（最新帧可见）；最早帧（写门控异常 01 90 03）可能被
    // 挤出视口（延迟响应的迟到帧也会占用视口）。滚动到顶部让最早帧渲染后断言，再滚回
    // 底部断言最新帧。
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
    const settings = await openTableSettings(frame);
    await expect(settings.locator(".table-toolbar__verify")).toContainText(
      "OFF",
    );
    await frame
      .getByRole("button", { name: "Table settings", exact: true })
      .click();
    await setWriteVerify(frame, "ON");
    await setRowAddress(frame, "0900");
    await writeRow(frame, "1234");
    await expect(
      frame.locator(".register-table__status-dot--error").first(),
    ).toBeVisible({ timeout: CONNECTED_TIMEOUT });
    await expect(
      frame.locator('[data-register-cell="data"]').first(),
    ).toHaveText("0000", {
      timeout: CONNECTED_TIMEOUT,
    });
    await expect(
      frame.locator('[data-register-cell="data"]').first(),
    ).not.toHaveText("1234");
    await readRow(frame);
    await expect(
      frame.locator('[data-register-cell="data"]').first(),
    ).toHaveText("0000", {
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

    // 重连：Connection Settings → 串口下拉复用 → 选 COM4 → Connect。
    await frame
      .getByRole("button", { name: "Connection settings" })
      .evaluate((el) => (el as HTMLElement).click());
    const modal = frame.locator(".ant-modal-container:visible");
    await modal.waitFor({ timeout: 10_000 });
    const rtu = rtuConfig();
    // 按 Port Form.Item 限定定位端口下拉（连接对象配置分组已移除）。
    await modal
      .locator(".ant-form-item")
      .filter({ hasText: "Port" })
      .locator(".ant-select")
      .first()
      .click();
    const option = frame
      .locator(".ant-select-dropdown:visible .ant-select-item-option")
      .filter({ hasText: rtu.port });
    await option.waitFor({ state: "visible", timeout: 15_000 });
    await option.click();
    // 真实端口稳定连接：RTU 超时手动输入设 Select 上限 100ms。
    await setRtuTimeoutSelect(frame, modal, 100);
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
