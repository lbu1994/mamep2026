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

test("真实 Modbus TCP（UI 级）：连接 + 全场景矩阵", async ({
  workbox,
  evaluateInVSCode,
}) => {
  const consoleErrors: string[] = [];
  workbox.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`CONSOLE: ${msg.text()}`);
  });
  workbox.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${String(err)}`));

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
    await expect(frame.locator(".ant-layout-header")).toContainText("Online", {
      timeout: CONNECTED_TIMEOUT,
    });
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
