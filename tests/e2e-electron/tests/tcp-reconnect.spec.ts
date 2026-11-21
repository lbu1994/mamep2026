/**
 * Electron Modbus TCP 自动重连 E2E（PRD §8.3 P1 已知限制打通）。
 * 生产构建路径启动（dist-electron/main.js + apps/web/dist-electron/，loadFile）。
 * 测试进程内启动本地回环 Modbus TCP Server（net，内联 MBAP responder），支持：
 * - dropClients()：断开当前客户端连接（模拟设备断线），服务器继续监听；
 * - stop()：停服并断开（模拟设备下线），重连尝试将失败。
 * 走真实路径：Connection Settings TCP 表单（autoReconnect 开关）→ 主进程
 * ElectronSessionHost（NodeTcpTransport + TcpSessionHost + ReconnectCoordinator）→
 * 断线自动重连 → FC03 读恢复；autoReconnect 关闭时不重连。
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
import { expectNoConsoleErrors } from "../no-console-guard";

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
 * 记录 connectionCount（接受的新连接数），支持断开当前客户端 / 整体停服。
 */
class FakeTcpDevice {
  readonly registers = new Map<number, number>();
  connectionCount = 0;
  port = 0;
  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();

  private handleSocket(socket: net.Socket): void {
    this.connectionCount += 1;
    this.sockets.add(socket);
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
          const value = this.registers.get(address) ?? 0;
          socket.write(
            buildTcpFrame(
              tid,
              unitId,
              Uint8Array.from([0x03, 0x02, (value >> 8) & 0xff, value & 0xff]),
            ),
          );
        } else if (fc === 0x10) {
          // FC10 写多寄存器请求 PDU：FC + addr(2) + qty(2) + byteCount(1) + data(2)。
          const value = (((frame[13] ?? 0) << 8) | (frame[14] ?? 0)) & 0xffff;
          this.registers.set(address, value);
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
      // 客户端断开 / 停服：忽略。
    });
    socket.on("close", () => {
      this.sockets.delete(socket);
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.handleSocket(socket));
      this.server = server;
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        this.port =
          typeof address === "object" && address !== null ? address.port : 0;
        resolve();
      });
    });
  }

  /** 断开当前客户端连接（模拟设备断线），服务器继续监听。 */
  dropClients(): void {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  /** 停服并断开现有连接（模拟设备下线），重连尝试将失败。 */
  stop(): void {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.server?.close();
    this.server = null;
  }
}

let app: ElectronApplication;
let page: Page;
let device: FakeTcpDevice;
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  device = new FakeTcpDevice();
  await device.start();

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
});

test.beforeEach(async () => {
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
});

test.afterAll(async () => {
  try {
    await app.close();
  } catch {
    // 已关闭。
  }
  expectNoConsoleErrors(consoleErrors);
});

/**
 * 经 Connection Settings 连接假 TCP 设备（可选开启 autoReconnect）。
 * 启动弹窗存在竞态（IndexedDB 清理/加载，全量套件下偶发弹窗未打开或已关闭），
 * 故每次先确认弹窗可见，不可见则经顶栏 Connect 重新打开；并对 TCP 表单/Switch
 * 显式等待后再交互，避免对未渲染元素长时挂起（偶发 flake 加固）。
 */
async function connectViaUi(autoReconnect: boolean): Promise<void> {
  const modal = page.locator(".ant-modal-container:visible");
  if ((await modal.count()) === 0) {
    // 启动竞态兜底：弹窗未打开 → 点顶栏 Offline · Connect 重新打开（不依赖 loadWorkspace）。
    await page
      .getByRole("button", { name: "Offline · Connect" })
      .first()
      .click();
  }
  await expect(modal).toBeVisible({ timeout: 15000 });
  // 弹窗打开动画完成后再交互（启动竞态 flake 加固，见仓库记忆 electron-modal-launch-race-flake）。
  await page.waitForTimeout(1000);
  await modal
    .locator(".ant-segmented-item")
    .filter({ hasText: "Modbus TCP" })
    .click();
  // 协议切换后 TCP 表单（含 Switch）才渲染：显式等待，避免对未渲染元素长时挂起。
  const hostInput = modal.getByPlaceholder("192.168.1.10");
  await expect(hostInput).toBeVisible({ timeout: 5000 });
  await hostInput.fill("127.0.0.1");
  const portInput = modal.locator(".ant-input-number-input").first();
  await portInput.click();
  await portInput.fill(String(device.port));
  // 显式确保 autoReconnect 开关处于期望状态（加固）：刷新前「清工作区→reload」
  // 的隔离假设已被的关闭时 flush 覆盖（保留最后状态），故不再依赖默认关闭，
  // 而是按期望值显式开/关，避免前序用例残留 autoReconnect=true 污染本用例。
  const switchEl = modal.locator(".ant-switch");
  await expect(switchEl).toBeVisible({ timeout: 5000 });
  const isOn = (await switchEl.getAttribute("aria-checked")) === "true";
  if (autoReconnect && !isOn) {
    await switchEl.click();
  } else if (!autoReconnect && isOn) {
    await switchEl.click();
  }
  await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 10000,
  });
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);
}

/** 首行填入地址 0001 并 FC03 单行读，断言 Data = ABCD。 */
async function readFirstRegister(): Promise<void> {
  const addressInput = page.getByLabel("Address", { exact: true }).first();
  await addressInput.click();
  await addressInput.fill("0001");
  await addressInput.press("Enter");
  await expect(
    page.getByRole("button", { name: "Read", exact: true }).first(),
  ).toBeEnabled({ timeout: 5000 });
  await page
    .getByRole("button", { name: "Read", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByLabel("Data").first()).toHaveText("ABCD", {
    timeout: 10000,
  });
}

test("断线后自动重连成功：新连接 + 回到 Online + FC03 读恢复", async () => {
  device.registers.set(0x0001, 0xabcd);
  await connectViaUi(true);
  await readFirstRegister();

  // 断开当前客户端连接（设备保持监听）。
  device.dropClients();
  // 自动重连：建立新 TCP 连接（connectionCount 递增）。
  await expect.poll(() => Promise.resolve(device.connectionCount)).toBe(2);
  // 回到 Online 并恢复读取。
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 10000,
  });
  await readFirstRegister();
});

test("autoReconnect 关闭：断线后不自动重连（保持 Interrupted）", async () => {
  device.registers.set(0x0001, 0xabcd);
  await connectViaUi(false);
  const countBefore = device.connectionCount;

  device.dropClients();
  await expect(page.locator(".ant-layout-header")).toContainText(
    "Interrupted",
    {
      timeout: 5000,
    },
  );
  // 等待超过首个退避间隔（1s），确认没有发起重连。
  await page.waitForTimeout(1500);
  expect(device.connectionCount).toBe(countBefore);
  await expect(page.locator(".ant-layout-header")).toContainText("Interrupted");
});

test("服务器离线：重连尝试失败，不回到 Online", async () => {
  device.registers.set(0x0001, 0xabcd);
  await connectViaUi(true);

  // 停服并断开现有连接（模拟设备下线）。
  device.stop();
  // 进入重连生命周期状态（reconnect-waiting / reconnecting / failed），不再 Online。
  await expect(page.locator(".ant-layout-header")).toContainText(
    /Reconnect pending|Reconnecting|Connection failed/,
    { timeout: 5000 },
  );
  await expect(page.locator(".ant-layout-header")).not.toContainText("Online");
});
