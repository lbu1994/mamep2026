/**
 * Android Modbus TCP 闭环 E2E。
 *
 * 真实路径（无任何桩）：真机 WebView（`https://localhost/`）加载共享 UI →
 * `AndroidAppHost` → `AndroidPlatformHost.openTcpTransport` → `CapacitorTcpTransport` →
 * Capacitor 桥 → app 内原生 `MamepTransportPlugin`（java.net.Socket）→ 宿主机 fake 从站。
 *
 * 断言：FC03 读回宿主侧预置寄存器、FC10 写入后宿主侧寄存器被改写（并写后回读显示）、
 * 断开回到未连接、无 console 错误。宿主侧断言（而非仅 UI）用于证明字节真的经原生 socket 走通
 * ——WebView 自身无法开 raw socket。
 *
 * 注意：本机 vivo 设备 `adb logcat` 无输出，故一切诊断走 CDP（见 helpers/adb.ts）。
 */
import {
  chromium,
  expect,
  test,
  type Browser,
  type Page,
} from "@playwright/test";
import * as net from "node:net";
import {
  clearAppData,
  forceStopApp,
  forwardDevtools,
  installApk,
  launchApp,
  removeAllForwards,
  removeAllReverses,
  requireDevice,
  reverseTcp,
  waitForWebviewSocket,
  CDP_PORT,
} from "../helpers/adb";
import { expectNoConsoleErrors } from "../console-guard";
import { setWriteVerify } from "../helpers/app";

/** 组 MBAP 帧（tid / proto=0 / length / unit + pdu），无 CRC。 */
function buildTcpFrame(tid: number, unitId: number, pdu: Uint8Array): Buffer {
  const length = 1 + pdu.length;
  const frame = Buffer.alloc(6 + length);
  frame.writeUInt16BE(tid, 0);
  frame.writeUInt16BE(length, 4);
  frame[6] = unitId;
  Buffer.from(pdu).copy(frame, 7);
  return frame;
}

interface FakeSlave {
  port: number;
  registers: Map<number, number>;
  /** 收到的请求（形如 "3:0"），用于证明字节真的经原生 socket 到达宿主。 */
  requests: string[];
  close(): Promise<void>;
}

/** 首行填地址（默认表行地址为空，不填则读请求不会生成：RegisterTableService 会直接报地址为空）。 */
async function setRowAddress(target: Page, address: string): Promise<void> {
  // 注意：不能用 /^Address/ 正则——会匹配到工具栏「Address format」进制切换控件与「Address Adjust」控件。
  const cell = target.getByLabel("Address", { exact: true }).first();
  await cell.click();
  const input = target.getByLabel("Address", { exact: true }).first();
  await expect(input).toBeEditable({ timeout: 10_000 });
  // fill() 用原生 value setter 设置 DOM 值，React onChange 可能不触发（仓库既有踩坑）：
  // 用 pressSequentially 逐字符输入（真实键盘事件），确认受控值同步后再 Enter 提交。
  await input.fill("");
  await input.pressSequentially(address, { delay: 10 });
  await expect(input).toHaveValue(address);
  await input.press("Enter");
}

/** 首行点击 Read。 */
async function readRow(target: Page): Promise<void> {
  await target
    .getByRole("button", { name: "Read", exact: true })
    .first()
    .evaluate((element) => (element as HTMLElement).click());
}

/** 首行填 Data（HEX）并点击 Write。 */
async function writeRow(target: Page, valueHex: string): Promise<void> {
  const cell = target.getByLabel("Data", { exact: true }).first();
  await cell.click();
  const input = target.getByLabel("Data", { exact: true }).first();
  await expect(input).toBeEditable({ timeout: 10_000 });
  await input.fill("");
  await input.pressSequentially(valueHex, { delay: 10 });
  await expect(input).toHaveValue(valueHex);
  await input.press("Enter");
  await target
    .getByRole("button", { name: "Write", exact: true })
    .first()
    .evaluate((element) => (element as HTMLElement).click());
}

/** 宿主侧 fake 从站：FC03 读 / FC0x10 写（共享寄存器表）。 */
function createFakeSlave(): Promise<FakeSlave> {
  const registers = new Map<number, number>();
  const requests: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const buffer: number[] = [];
    socket.on("data", (chunk: Buffer) => {
      for (const byte of chunk) buffer.push(byte);
      for (;;) {
        if (buffer.length < 7) return;
        const declaredLength = ((buffer[4] ?? 0) << 8) | (buffer[5] ?? 0);
        if (declaredLength < 1 || declaredLength > 254) {
          buffer.shift();
          continue;
        }
        const frameLength = 6 + declaredLength;
        if (buffer.length < frameLength) return;
        const frame = Uint8Array.from(buffer.splice(0, frameLength));
        const tid = (((frame[0] ?? 0) << 8) | (frame[1] ?? 0)) & 0xffff;
        const unitId = frame[6] ?? 0;
        const fc = frame[7] ?? 0;
        const address = (((frame[8] ?? 0) << 8) | (frame[9] ?? 0)) & 0xffff;
        requests.push(`${fc.toString(16)}:${address}`);
        if (fc === 0x03) {
          const value = registers.get(address) ?? 0;
          socket.write(
            buildTcpFrame(
              tid,
              unitId,
              Uint8Array.from([0x03, 0x02, (value >> 8) & 0xff, value & 0xff]),
            ),
          );
        } else if (fc === 0x10) {
          const value = (((frame[13] ?? 0) << 8) | (frame[14] ?? 0)) & 0xffff;
          registers.set(address, value);
          socket.write(
            buildTcpFrame(
              tid,
              unitId,
              Uint8Array.from([
                0x10,
                (address >> 8) & 0xff,
                address & 0xff,
                0x00,
                0x01,
              ]),
            ),
          );
        } else {
          socket.write(
            buildTcpFrame(tid, unitId, Uint8Array.from([fc | 0x80, 0x01])),
          );
        }
      }
    });
    socket.on("error", () => {
      // 客户端断开：忽略。
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        port,
        registers,
        requests,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

let browser: Browser;
let page: Page;
let slave: FakeSlave;
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  requireDevice();
  slave = await createFakeSlave();

  installApk();
  // 清空应用数据 → 干净工作区（避免跨运行残留的 profile/插件状态污染断言）。
  clearAppData();
  forceStopApp();
  reverseTcp(slave.port);
  launchApp();

  const socket = await waitForWebviewSocket();
  forwardDevtools(socket, CDP_PORT);

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0];
  if (context === undefined) throw new Error("CDP 未返回 WebView context");
  page = context.pages()[0] ?? (await context.waitForEvent("page"));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.waitForSelector(".register-table-tabs", { timeout: 60_000 });
  // 非 mock 启动自动弹出 Connection Settings（等动画完成再交互，防启动竞态）。
  await page.waitForSelector(".ant-modal-container:visible", {
    timeout: 30_000,
  });
  await page.waitForTimeout(1000);
});

test.afterAll(async () => {
  await browser?.close();
  removeAllForwards();
  removeAllReverses();
  forceStopApp();
  await slave?.close();
  expectNoConsoleErrors(consoleErrors);
});

test("真机 WebView + 原生插件：TCP 连接 → FC03 读 → FC10 写（写后回读）→ 断开", async () => {
  // 平台确认为 Android（Capacitor 容器；同一份 UI 产物）。
  expect(await page.evaluate(() => window.Capacitor?.getPlatform?.())).toBe(
    "android",
  );
  expect(page.url()).toContain("https://localhost");

  //  Android 同时支持 RTU 与 TCP → 协议分组可见；本用例显式切到 TCP。
  await expect(page.locator(".ant-modal-container")).toContainText(
    "Modbus TCP",
  );
  await page
    .locator(".ant-modal-container")
    .getByText("Modbus TCP", { exact: true })
    .first()
    .click();
  await page.waitForTimeout(300);

  await page.getByPlaceholder("192.168.1.10").fill("127.0.0.1");
  const spinbuttons = page.locator(
    '.ant-modal-container input[role="spinbutton"]',
  );
  await spinbuttons.nth(0).fill(String(slave.port));
  await page.waitForTimeout(200);

  await page
    .locator(".ant-modal-container .ant-btn")
    .filter({ hasText: "CONNECT" })
    .click();

  // 连接成功：弹窗自动关闭，头部状态显示 Online；可访问名称保留断开快捷动作。
  await expect(page.locator(".ant-modal-container:visible")).toBeHidden({
    timeout: 20_000,
  });
  const disconnectButton = page
    .locator(".mamep-header")
    .getByRole("button", { name: "Online · Disconnect" });
  await expect(disconnectButton).toBeVisible({ timeout: 20_000 });

  // 新表默认 OFF；本用例显式 ON，以覆盖写后回读一致性。
  await expect(page.locator(".table-toolbar__verify")).toContainText("OFF");
  await setWriteVerify(page, "ON");

  // 首行填地址 0（默认表行地址为空），并在宿主侧预置寄存器 0 = 0x00AB。
  await setRowAddress(page, "0");
  slave.registers.set(0, 0x00ab);

  // FC03：读第一行 → Data 显示宿主预置值 00AB，且宿主侧确实收到了 FC03 请求。
  await readRow(page);
  const dataInput = page.getByLabel("Data", { exact: true }).first();
  await expect(dataInput).toHaveText("00AB", { timeout: 20_000 });
  expect(slave.requests).toContain("3:0");

  // FC10：改 Data 为 12AB 并提交，点击 Write → 宿主侧寄存器被改写（证明写在真实链路上）。
  await writeRow(page, "12AB");

  await expect
    .poll(() => slave.registers.get(0), { timeout: 20_000 })
    .toBe(0x12ab);
  // 写后回读显式 ON：回读一致后单元格显示写入值。
  await expect(dataInput).toHaveText("12AB", { timeout: 20_000 });
  await setWriteVerify(page, "OFF");

  // 断开：回到未连接状态（头部状态恢复为 Offline）。
  await disconnectButton.evaluate((element) =>
    (element as HTMLElement).click(),
  );
  await expect(disconnectButton).toBeHidden({ timeout: 20_000 });
});
