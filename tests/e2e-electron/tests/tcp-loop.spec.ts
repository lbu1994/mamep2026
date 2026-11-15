/**
 * Electron Modbus TCP 闭环 E2E（两端 TCP 接线）。
 * 生产构建路径启动（dist-electron/main.js + apps/web/dist-electron/，loadFile）。
 * 测试进程内启动本地回环 Modbus TCP Server（net，内联 MBAP responder），
 * 走真实路径：Connection Settings TCP 表单 → 主进程 ElectronSessionHost（Node
 * NodeTcpTransport + TcpSessionHost）→ MBAP 分帧/Transaction ID → FC03 读 + FC10 写闭环。
 * RTU/Web Serial 权限逻辑由既有 e2e + apps/electron 单测覆盖。
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
import { clearWorkspaceFile } from "../clear-workspace-file";

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

/** 测试进程内假 TCP 设备：MBAP responder（FC03 读 / FC10 写，共享寄存器状态）。 */
function createFakeTcpServer(): Promise<{
  port: number;
  registers: Map<number, number>;
}> {
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
          // FC10 写多寄存器请求 PDU：FC + addr(2) + qty(2) + byteCount(1) + data(2)。
          // MBAP 7B 后：frame[7]=fc、[8..9]=addr、[10..11]=qty、[12]=byteCount、[13..14]=值。
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
      resolve({ port, registers });
    });
  });
}

let app: ElectronApplication;
let page: Page;
let fakePort = 0;
let fakeRegisters: Map<number, number>;
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  const fake = await createFakeTcpServer();
  fakePort = fake.port;
  fakeRegisters = fake.registers;

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
  // 工作区持久化使用文件仓储：IndexedDB 清理不涉及工作区，
  // 一并删除 userData 下 workspace.json(.bak)，避免跨测试/跨运行污染。
  await clearWorkspaceFile(app);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  // 非 mock 启动自动弹出 Connection Settings。
  await page.waitForSelector(".ant-modal-container:visible", {
    timeout: 15000,
  });
  // 弹窗打开动画完成后再交互（启动竞态 flake 加固，见仓库记忆 electron-modal-launch-race-flake）。
  await page.waitForTimeout(1000);
});

test.afterAll(async () => {
  try {
    await app.close();
  } catch {
    // 已关闭。
  }
});

test("TCP 配置连接 + FC03 读 + FC10 写闭环（主进程会话）", async () => {
  // 预置设备寄存器 0x0001 = 0xABCD。
  fakeRegisters.set(0x0001, 0xabcd);

  const modal = page.locator(".ant-modal-container:visible");
  // 1. 切换到 Modbus TCP（Segmented 选项）。
  await modal
    .locator(".ant-segmented-item")
    .filter({ hasText: "Modbus TCP" })
    .click();

  // 2. 填写 host（占位符 192.168.1.10 的 Input）与端口（TCP 模式下第一个 InputNumber）。
  const hostInput = modal.getByPlaceholder("192.168.1.10");
  await expect(hostInput).toBeVisible({ timeout: 5000 });
  await hostInput.fill("127.0.0.1");
  const portInput = modal.locator(".ant-input-number-input").first();
  await portInput.click();
  await portInput.fill(String(fakePort));

  // 3. Connect：连接成功 → 弹窗关闭，顶栏 Online。
  await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 10000,
  });
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);

  // 4. 首行填入地址 0001。
  const addressInput = page.getByLabel("Address", { exact: true }).first();
  await addressInput.click();
  await addressInput.fill("0001");
  await addressInput.press("Enter");

  // 5. FC03 单行读：Data 显示 ABCD（hex）。
  await page
    .getByRole("button", { name: "Read", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByLabel("Data").first()).toHaveText("ABCD", {
    timeout: 10000,
  });

  // 6. FC10 单行写：12AB 写入设备寄存器（假 TCP 设备寄存器回读确认）。
  const dataInput = page.getByLabel("Data").first();
  await dataInput.click();
  await dataInput.fill("12AB");
  await dataInput.press("Enter");
  await page
    .getByRole("button", { name: "Write", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect
    .poll(() => Promise.resolve(fakeRegisters.get(0x0001)))
    .toBe(0x12ab);
});

test("无 console 错误（含 CSP 违规、antd 弃用）", async () => {
  expect(consoleErrors).toEqual([]);
});
