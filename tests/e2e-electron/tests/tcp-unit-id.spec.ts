/**
 * Electron TCP Unit ID 会话内动态修改 E2E（2026-08-25，ADR-022 已知限制打通）。
 * 生产构建路径启动（dist-electron/main.js + apps/web/dist-electron/，loadFile）。
 * 测试进程内启动本地回环 Modbus TCP Server（记录收到的请求帧 Unit ID）。
 * 走真实路径：Connection Settings TCP 表单 → 主进程 ElectronSessionHost →
 * 工具栏「Unit ID」改为新值（渲染端经 session-set-unit-id 远程代理主进程）→
 * FC03 读 → 断言假设备收到的请求帧 Unit ID 为新值 → 无 console 错误。
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

/** 测试进程内假 TCP 设备：MBAP responder（FC03 读 / FC10 写）+ 请求帧 Unit ID 记录。 */
function createFakeTcpServer(): Promise<{
  port: number;
  registers: Map<number, number>;
  seenUnitIds: number[];
}> {
  const registers = new Map<number, number>();
  const seenUnitIds: number[] = [];
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
        seenUnitIds.push(unitId);
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
            buildTcpFrame(
              tid,
              unitId,
              Uint8Array.from([fc | 0x80, 0x01]),
            ),
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
      resolve({ port, registers, seenUnitIds });
    });
  });
}

let app: ElectronApplication;
let page: Page;
let fakePort = 0;
let fakeRegisters: Map<number, number>;
let fakeSeenUnitIds: number[];
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  const fake = await createFakeTcpServer();
  fakePort = fake.port;
  fakeRegisters = fake.registers;
  fakeSeenUnitIds = fake.seenUnitIds;

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
  // 工作区持久化已改为文件仓储（ADR-036，2026-08-30）：IndexedDB 清理不再清除工作区，
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

test("TCP 连接 → 工具栏改 Unit ID → FC03 读断言请求帧 unitId 变化", async () => {
  // 预置设备寄存器 0x0001 = 0xABCD。
  fakeRegisters.set(0x0001, 0xabcd);

  const modal = page.locator(".ant-modal-container:visible");
  // 1. 切换到 Modbus TCP（Segmented 选项）。
  await modal
    .locator(".ant-segmented-item")
    .filter({ hasText: "Modbus TCP" })
    .click();

  // 2. 填写 host 与端口。
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
  const addressInput = page.getByLabel("Register", { exact: true }).first();
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

  // 6. 工具栏「Unit ID」（TCP 连接后 aria-label 切换为 Unit ID）改为 9：
  //    渲染端 setSlaveAddress → 按活动协议路由 session-set-unit-id → 主进程会话 setUnitId。
  const unitIdInput = page.getByLabel("Unit ID");
  await unitIdInput.click();
  await unitIdInput.fill("9");
  await unitIdInput.press("Enter");

  // 7. 再次 FC03 读：假设备收到的请求帧 Unit ID 应为 9。
  const before = fakeSeenUnitIds.length;
  await page
    .getByRole("button", { name: "Read", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect
    .poll(() => fakeSeenUnitIds.slice(before).some((id) => id === 9))
    .toBe(true);
  // 读值不受影响。
  await expect(page.getByLabel("Data").first()).toHaveText("ABCD", {
    timeout: 10000,
  });

  // 8. 无 console 错误。
  expect(consoleErrors).toEqual([]);
});
