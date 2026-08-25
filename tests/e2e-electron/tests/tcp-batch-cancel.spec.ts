/**
 * Electron Modbus TCP 全表读取取消 E2E（ADR-025，2026-08-25）。
 * 生产构建路径启动（dist-electron/main.js + apps/web/dist-electron/，loadFile）。
 * 测试进程内启动本地回环 Modbus TCP Server（net，内联 MBAP responder，FC03 响应可延迟），
 * 走真实路径：Connection Settings TCP 表单 → 主进程 ElectronSessionHost → 多行地址 →
 * Read All → 运行态出现取消按钮 → 点击取消 → 汇总消息 cancelledCount > 0 + 无 console 错误。
 * 覆盖「远程批任务取消」闭环：渲染端 session-batch-read（携带 batchId）→ 中途
 * session-batch-cancel → 宿主 BatchReadCoordinator 取消排队行。
 */
import {
  _electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import * as net from "node:net";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
/** 仓库根目录（本文件位于 tests/e2e-electron/tests/）。 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** 组 MBAP 帧（tid/proto=0/length/unit + pdu），无 CRC。 */
function buildTcpFrame(tid: number, unitId: number, pdu: Uint8Array): Buffer {
  const length = 1 + pdu.length;
  const frame = Buffer.alloc(6 + length);
  frame.writeUInt16BE(tid, 0);
  frame.writeUInt16BE(length, 4);
  frame[6] = unitId;
  Buffer.from(pdu).copy(frame, 7);
  return frame;
}

/**
 * 测试进程内假 TCP 设备：MBAP responder（FC03 读 / FC10 写，共享寄存器状态）。
 * delayResponseMs > 0 时 FC03 响应延迟发送——制造「批任务进行中」的可取消窗口
 * （默认立即响应，供既有闭环用例复用）。
 */
function createFakeTcpServer(
  delayResponseMs = 0,
): Promise<{ port: number; registers: Map<number, number> }> {
  const registers = new Map<number, number>();
  const server = net.createServer((socket) => {
    const buffer: number[] = [];
    socket.on("data", (chunk: Buffer) => {
      for (const byte of chunk) buffer.push(byte);
      while (true) {
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
        let response: Buffer | null = null;
        if (fc === 0x03) {
          const value = registers.get(address) ?? 0;
          response = buildTcpFrame(
            tid,
            unitId,
            Uint8Array.from([0x03, 0x02, (value >> 8) & 0xff, value & 0xff]),
          );
        } else if (fc === 0x10) {
          const value = (((frame[13] ?? 0) << 8) | (frame[14] ?? 0)) & 0xffff;
          registers.set(address, value);
          response = buildTcpFrame(
            tid,
            unitId,
            Uint8Array.from([
              0x10,
              (address >> 8) & 0xff,
              address & 0xff,
              0x00,
              0x01,
            ]),
          );
        } else {
          response = buildTcpFrame(
            tid,
            unitId,
            Uint8Array.from([fc | 0x80, 0x01]),
          );
        }
        if (delayResponseMs > 0 && fc === 0x03) {
          setTimeout(() => socket.write(response as Buffer), delayResponseMs);
        } else {
          socket.write(response as Buffer);
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
      resolve({ port, registers });
    });
  });
}

let app: ElectronApplication;
let page: Page;
let fakePort = 0;
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  // FC03 延迟 400ms：批任务逐行 50ms Rx Delay + 400ms 响应，8 行 ≈ 3.6s，
  // 足以在点击取消前保持「批任务进行中」。
  const fake = await createFakeTcpServer(400);
  fakePort = fake.port;

  app = await _electron.launch({
    executablePath: require("electron"),
    args: ["dist-electron/main.js"],
    cwd: REPO_ROOT,
  });
  page = await app.firstWindow();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

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
    timeout: 15000,
  });
});

test.afterAll(async () => {
  try {
    await app.close();
  } catch {
    // 已关闭。
  }
});

test("TCP 全表读取取消：Read All → 取消 → 汇总 cancelledCount > 0 + 无 console 错误", async () => {
  const modal = page.locator(".ant-modal-container:visible");
  // 1. 切换到 Modbus TCP 并连接本地假设备。
  await modal.locator(".ant-segmented-item").filter({ hasText: "Modbus TCP" }).click();
  const hostInput = modal.getByPlaceholder("192.168.1.10");
  await hostInput.fill("127.0.0.1");
  const portInput = modal.locator(".ant-input-number-input").first();
  await portInput.click();
  await portInput.fill(String(fakePort));
  await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 10000,
  });
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);

  // 2. 前 8 行填入地址（默认表 50 行空地址；Read All 跳过空地址）。
  const rowCount = 8;
  for (let i = 0; i < rowCount; i++) {
    const address = (0x0100 + i).toString(16).padStart(4, "0");
    const input = page.getByLabel("Register", { exact: true }).nth(i);
    await input.click();
    await input.fill(address);
    await input.press("Enter");
  }

  // 3. 点击 Read All：运行态出现取消按钮。
  await page
    .getByRole("button", { name: "reload Read All" })
    .click();
  await expect(page.getByRole("button", { name: /Cancel/ })).toBeVisible({
    timeout: 5000,
  });

  // 4. 取消：立即退出运行态，汇总消息含 cancelledCount > 0。
  await page.getByRole("button", { name: /Cancel/ }).click();
  await expect(
    page.getByRole("button", { name: /Cancel/ }),
  ).toHaveCount(0);

  await expect(page.locator(".bottom-panel")).toContainText(/cancelled/, {
    timeout: 10000,
  });
  const summaryText = (await page.locator(".bottom-panel").innerText()).match(
    /Read All:.*?(\d+)\s+cancelled/,
  );
  const cancelledCount = Number(summaryText?.[1] ?? 0);
  expect(cancelledCount).toBeGreaterThan(0);
});

test("无 console 错误（含 CSP 违规、antd 弃用）", async () => {
  expect(consoleErrors).toEqual([]);
});
