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
import type { Frame, Page } from "@playwright/test";
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

/** 等待生产 webview frame（url 前缀 vscode-webview://）出现。 */
async function waitForWebviewFrame(page: Page): Promise<Frame> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const frame = page
      .frames()
      .find((f) => f.url().startsWith("vscode-webview://"));
    if (frame !== undefined) return frame;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("webview frame（vscode-webview://）未出现（确认已 pnpm build:vscode）");
}

/** 将当前表 Register 地址列进制切到 HEX（与从站规则地址一致，ADR-014）。 */
async function setRadixHex(frame: Frame): Promise<void> {
  await frame.locator(".table-toolbar__radix .ant-select").first().click();
  await frame
    .locator(".ant-select-dropdown:visible")
    .getByText("HEX", { exact: true })
    .click();
  await expect(frame.locator(".table-toolbar__radix")).toContainText("HEX", {
    timeout: 5000,
  });
}

/** 首行填入地址（HEX 4 位）并提交。 */
async function setRowAddress(frame: Frame, addressHex: string): Promise<void> {
  const input = frame.getByLabel("Register", { exact: true }).first();
  await input.click();
  await input.fill(addressHex);
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
  const data = frame.getByLabel("Data").first();
  await data.click();
  await data.fill(valueHex);
  await data.press("Enter");
  await frame
    .getByRole("button", { name: "Write", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

test("真实串口 RTU（UI 级）：连接 + 全场景矩阵", async ({
  workbox,
  evaluateInVSCode,
}) => {
  const consoleErrors: string[] = [];
  workbox.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`CONSOLE: ${msg.text()}`);
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
    const rtu = rtuConfig();
    await modal.locator(".ant-select").first().click();
    const option = frame
      .locator(".ant-select-dropdown:visible .ant-select-item-option")
      .filter({ hasText: rtu.port });
    await option.waitFor({ state: "visible", timeout: 15_000 });
    await option.click();

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
    await setRowAddress(frame, "0000");
    await readRow(frame);
    await expect(frame.getByLabel("Data").first()).toHaveText("04D2", {
      timeout: CONNECTED_TIMEOUT,
    });
  });

  await test.step("通信日志：请求/响应/异常帧字节", async () => {
    await frame.getByRole("tab", { name: "Comm Log" }).click();
    await frame.waitForTimeout(300);
    const list = frame.locator(".comm-log .ant-listy-holder");
    await expect(list).toContainText("01 03 00 00 00 01", { timeout: 5000 });
    await expect(list).toContainText("01 03 02 04 D2");
    await expect(list).toContainText("01 90 03");
    await expect(list).toContainText("01 90 02");
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
    await modal.locator(".ant-select").first().click();
    const option = frame
      .locator(".ant-select-dropdown:visible .ant-select-item-option")
      .filter({ hasText: rtu.port });
    await option.waitFor({ state: "visible", timeout: 15_000 });
    await option.click();
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
