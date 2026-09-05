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
 * VSCode 1.134 webview 为两层：容器 frame（vscode-webview://.../index.html）内嵌
 * 内容 frame（vscode-webview://.../fake.html，承载 #root/.ant-app 共享 UI）。
 * 按 url 前缀会误匹配容器 frame，须定位含 UI 的内容 frame（2026-08-25 实测）。
 */
async function waitForWebviewFrame(page: Page): Promise<Frame> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const f of page.frames()) {
      if (!f.url().startsWith("vscode-webview://")) continue;
      try {
        const hasUi = await f.evaluate(
          () =>
            document.querySelector("#root .ant-app, .ant-layout") !== null,
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

/** 将当前表 Register 地址列进制切到 HEX（与从站规则地址一致，ADR-014）。 */
async function setRadixHex(frame: Frame): Promise<void> {
  await frame
    .locator(".table-toolbar__radix .ant-segmented-item")
    .filter({ hasText: "HEX" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(frame.locator(".table-toolbar__radix")).toContainText("HEX", {
    timeout: 5000,
  });
}

/** 首行填入地址（HEX 4 位）并提交。 */
async function setRowAddress(frame: Frame, addressHex: string): Promise<void> {
  const cell = frame.getByLabel("Register", { exact: true }).first();
  await cell.click();
  // 等待进入编辑态（click 触发 React 重渲染渲染出 input；高负载下可能延迟）。
  const input = frame.getByLabel("Register", { exact: true }).first();
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

/**
 * 把 RTU 超时 Select 设为固定档位。真实端口 e2e 稳定连接：应用默认超时已改为 50ms
 * （2026-09-06），对 com0com 虚拟串口偏紧，测试连接显式手动输入 Select 上限 100ms。
 * 通过 showSearch 的手动输入（键入数值 + Enter）选中，避免点击下拉选项的脆弱性。
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
  await frame.page().keyboard.press("Control+a");
  await frame.page().keyboard.type(String(timeoutMs));
  await frame.page().keyboard.press("Enter");
  await expect(modal).toContainText(`${timeoutMs} ms`, { timeout: 5000 });
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
    // （vscode-webview://）的 console 错误（2026-08-26 real e2e 修复）。
    const sourceUrl = msg.location()?.url ?? "";
    if (!sourceUrl.startsWith("vscode-webview://")) return;
    consoleErrors.push(`CONSOLE: ${msg.text()}`);
  });
  workbox.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${String(err)}`));

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
    // 按 Port Form.Item 限定定位端口下拉（连接对象配置分组已移除，ADR-034）。
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
    await expect(frame.locator(".ant-layout-header")).toContainText("Online", {
      timeout: CONNECTED_TIMEOUT,
    });
    await expect(frame.locator(".ant-modal-container:visible")).toHaveCount(0);

    // 地址进制切到 HEX，便于按从站规则地址操作。
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
    // retryCount+1 共 2 次 ≈ 100ms）之后才到达；若此时立即发起新读，RTU 无 Transaction ID
    // 会把迟到的 0x0700 响应当作新读的响应（真实串口时序竞态，曾致读 0x0000 返回 0x0700
    // 的值 0000）。两次重试（attempt1/attempt2）均在 ~100ms 内超时，两帧迟到响应各在其请求
    // 后 ~2500ms 到达（~2500 / ~2550ms）。等两帧迟到响应都在无活动请求时（pendingExchange
    // 为空）到达并被丢弃，再读回正常区（2026-09-06：默认超时改 50ms，等待 3000ms 覆盖）。
    await frame.waitForTimeout(3000);
    await setRowAddress(frame, "0000");
    await readRow(frame);
    await expect(frame.getByLabel("Data").first()).toHaveText("04D2", {
      timeout: CONNECTED_TIMEOUT,
    });
  });

  await test.step("通信日志：请求/响应/异常帧字节", async () => {
    // Listy 虚拟列表只渲染视口内的行：共享会话下历史帧已被滚动挤出，
    // 清空后在测试内重建目标帧（写值门控异常 0x03、只读区异常 0x02、读 0x0000）。
    await frame.getByRole("tab", { name: "Comm Log" }).click();
    await frame.getByRole("button", { name: /Clear/i }).click();
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
    const list = frame.locator(".comm-log .ant-listy-holder");
    // Listy 虚拟列表默认停在底部（最新帧可见）；最早帧（写门控异常 01 90 03）可能被
    // 挤出视口（延迟响应的迟到帧也会占用视口）。滚动到顶部让最早帧渲染后断言，再滚回
    // 底部断言最新帧（2026-08-26 real e2e 修复）。
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
  });

  await test.step("写后回读 Verify=ON（默认）：写忽略区 0x0900 → Data 显示回读值 0000", async () => {
    // 写忽略区（0x0900–0x090f）：写入返回正常成功帧但不落盘——回读仍为旧值 0。
    // Verify=ON（本表默认）：写入后立即 FC03 回读 → 值不一致 → 失败点（红点），
    // Data 列被回读值覆盖（§15.1）显示 0000 而非写入的 1234。
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
  });

  await test.step("断开连接 → Offline，重连 → Online（稳定性）", async () => {
    await frame.getByRole("button", { name: /Disconnect/i }).click();
    await expect(frame.locator(".ant-layout-header")).toContainText("Offline", {
      timeout: CONNECTED_TIMEOUT,
    });

    // 重连：Connection Settings → 串口下拉复用 → 选 COM4 → Connect。
    await frame
      .getByRole("button", { name: "Connection" })
      .evaluate((el) => (el as HTMLElement).click());
    const modal = frame.locator(".ant-modal-container:visible");
    await modal.waitFor({ timeout: 10_000 });
    const rtu = rtuConfig();
    // 按 Port Form.Item 限定定位端口下拉（连接对象配置分组已移除，ADR-034）。
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
    await expect(frame.locator(".ant-layout-header")).toContainText("Online", {
      timeout: CONNECTED_TIMEOUT,
    });
  });

  await test.step("无 console 错误（含 CSP 违规、antd 弃用）", async () => {
    expect(
      consoleErrors,
      `console/page errors: ${consoleErrors.join(" | ")}`,
    ).toEqual([]);
  });
});
