/**
 * Electron Web Serial RTU 闭环 E2E。
 * 生产构建路径启动（dist-electron/main.js + apps/web/dist-electron/，loadFile）。
 * 渲染器注入自包含 fake navigator.serial（真实字节流 + 内联 CRC16 Modbus RTU responder），
 * 覆盖「串口授权选择（含用户取消 ok(null)）+ FC03 读 + FC10 写」闭环，走真实
 * WebSerialTransport / 调度器 / 协议层；主进程 select-serial-port 授权逻辑由
 * apps/electron 单测覆盖（本用例不依赖真实系统串口）。
 */
import {
  _electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import { clearWorkspaceFile } from "../clear-workspace-file";

const require = createRequire(import.meta.url);
/** 仓库根目录（本文件位于 tests/e2e-electron/tests/）。 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * 自包含 fake navigator.serial（页面上文执行，无模块依赖）：
 * - requestPort 返回带真实 ReadableStream/WritableStream 的 fake port；
 * - 写侧经 CRC16 Modbus RTU responder 应答（FC03 读保持寄存器 / FC10 写）并推入读侧；
 * - 暴露 window.__mamepFakeSerial 供测试预置寄存器 / 模拟用户取消。
 */
const FAKE_SERIAL_SOURCE = String.raw`
(() => {
  function crc16(data) {
    let crc = 0xffff;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let b = 0; b < 8; b++) {
        crc = (crc & 1) ? ((crc >>> 1) ^ 0xa001) : (crc >>> 1);
      }
    }
    return crc;
  }
  function appendCrc(bytes) {
    const crc = crc16(bytes);
    const out = new Uint8Array(bytes.length + 2);
    out.set(bytes);
    out[bytes.length] = crc & 0xff;
    out[bytes.length + 1] = (crc >> 8) & 0xff;
    return out;
  }
  const registers = new Map();
  // must-multi 区起始地址：该地址起单读/单写返回异常 0x02，多读/多写正常。
  const mustMultiStart = 0x0800;
  function handleFrame(frame) {
    if (frame.length < 8) return null;
    const slave = frame[0];
    const fc = frame[1];
    const address = ((frame[2] << 8) | frame[3]) & 0xffff;
    if (fc === 0x03) {
      const quantity = ((frame[4] << 8) | frame[5]) & 0xffff;
      if (quantity === 1 && address >= mustMultiStart) {
        return appendCrc(new Uint8Array([slave, 0x83, 0x02]));
      }
      const values = [];
      for (let i = 0; i < quantity; i++) {
        values.push(registers.get((address + i) & 0xffff) || 0);
      }
      return appendCrc(new Uint8Array([
        slave, 0x03, quantity * 2,
        ...values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]),
      ]));
    }
    if (fc === 0x10) {
      const quantity = ((frame[4] << 8) | frame[5]) & 0xffff;
      if (quantity === 1 && address >= mustMultiStart) {
        return appendCrc(new Uint8Array([slave, 0x90, 0x02]));
      }
      const values = [];
      for (let i = 0; i < quantity; i++) {
        values.push(((frame[7 + i * 2] << 8) | frame[8 + i * 2]) & 0xffff);
      }
      for (let i = 0; i < quantity; i++) {
        registers.set((address + i) & 0xffff, values[i]);
      }
      return appendCrc(new Uint8Array([
        slave, 0x10, (address >> 8) & 0xff, address & 0xff,
        (quantity >> 8) & 0xff, quantity & 0xff,
      ]));
    }
    return appendCrc(new Uint8Array([slave, fc | 0x80, 0x01]));
  }
  let controller = null;
  const readable = new ReadableStream({
    start(c) { controller = c; },
  });
  const writable = new WritableStream({
    write(chunk) {
      const resp = handleFrame(chunk);
      if (resp !== null && controller !== null) controller.enqueue(resp);
    },
  });
  const port = {
    open: async function () {},
    close: async function () {},
    readable: readable,
    writable: writable,
    getInfo: function () { return { usbVendorId: 0x1234, usbProductId: 0x5678 }; },
  };
  // enumerated 选择流程：requestPort 返回挂起 Promise，由测试显式 resolve/reject
  // （模拟主进程 select-serial-port 转发列表后，经 callback 才让 requestPort settle）。
  const pending = [];
  const serial = {
    getPorts: async function () { return []; },
    requestPort: function () {
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
  };
  try {
    Object.defineProperty(navigator, "serial", { configurable: true, value: serial });
  } catch (e) {
    Object.defineProperty(Navigator.prototype, "serial", {
      configurable: true,
      get: function () { return serial; },
    });
  }
  window.__mamepFakeSerial = {
    setRegister: function (a, v) { registers.set(a & 0xffff, v & 0xffff); },
    getRegister: function (a) {
      const key = a & 0xffff;
      return registers.has(key) ? registers.get(key) : null;
    },
    hasPendingRequest: function () { return pending.length > 0; },
    resolveRequest: function () {
      const p = pending.shift();
      if (p !== undefined) p.resolve(port);
    },
    rejectRequest: function (name) {
      const p = pending.shift();
      if (p !== undefined) p.reject(new DOMException("canceled", name || "NotFoundError"));
    },
  };
})();
`;

/** fake navigator.serial 暴露给测试的接口（window.__mamepFakeSerial）。 */
interface FakeSerialApi {
  setRegister(a: number, v: number): void;
  getRegister(a: number): number | null;
  hasPendingRequest(): boolean;
  resolveRequest(): void;
  rejectRequest(name?: string): void;
}

let app: ElectronApplication;
let page: Page;
const consoleErrors: string[] = [];

test.beforeAll(async () => {
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

  // 注入 fake navigator.serial（init script 早于页面脚本 / React host 构造），
  // 并清理 IndexedDB 避免跨运行残留工作区，随后重载生效。
  await page.addInitScript(FAKE_SERIAL_SOURCE);
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
  // 注意：枚举改为用户手势触发（点开下拉框 / 点刷新），弹窗打开不会自动枚举，
  // 因此这里不再等待挂起 requestPort。各用例自行触发并解析。
});

test.afterAll(async () => {
  try {
    await app.close();
  } catch {
    // 已关闭。
  }
});

test("取消/无可用端口：下拉框空态、无端口标签、无错误", async () => {
  const modal = page.locator(".ant-modal-container:visible");
  // 端口控件须限定在 Port 表单项内（连接对象配置分组已移除）。
  const portField = modal.locator(".ant-form-item").filter({ hasText: "Port" });
  const portSelect = portField.locator(".ant-select");
  const portRefresh = portField.locator('button[title="Refresh"]');
  // 触发刷新重新枚举，并拒绝请求（模拟无可用端口 / 用户取消）。
  // `force: true`：`click()` 的稳定性检查要求元素连续两帧包围盒一致，高负载（`pnpm test:all`
  // 串行跑完全量套件后）会因重排/重渲染判定 not stable 并重试到超时（实测）；
  // force 仍派发完整鼠标事件，仅跳过行动性检查。
  await portRefresh.click({ force: true });
  await page.waitForFunction(() => {
    const fake = (window as unknown as { __mamepFakeSerial: FakeSerialApi })
      .__mamepFakeSerial;
    return fake.hasPendingRequest();
  });
  await page.evaluate(() => {
    (
      window as unknown as { __mamepFakeSerial: FakeSerialApi }
    ).__mamepFakeSerial.rejectRequest("NotFoundError");
  });

  // 打开端口下拉框：空态提示、无端口选项、
  // 弹窗内无端口标签与「先选择设备」类错误。
  // 注：antd v6 Select 无 .ant-select-selector 类，点击根元素 .ant-select 打开下拉；
  // 不能用 DOM `.click()`（不触发 mousedown → 下拉框不开），故用 `force: true` 跳过稳定性检查。
  await portSelect.click({ force: true });
  const dropdown = page.locator(".ant-select-dropdown:visible");
  await expect(dropdown).toContainText("No serial ports found");
  await expect(page.getByRole("option", { name: "USB 1234:5678" })).toHaveCount(
    0,
  );
  await expect(modal).not.toContainText("USB 1234:5678");
  await expect(modal).not.toContainText(/select device first/i);
  // 清理：打开下拉框会再次触发枚举（挂起），settle 掉避免残留请求影响下一用例。
  await page.evaluate(() => {
    (
      window as unknown as { __mamepFakeSerial: FakeSerialApi }
    ).__mamepFakeSerial.rejectRequest("NotFoundError");
  });
  await page.keyboard.press("Escape");
});

test("串口下拉选择 + FC03 读 + FC10 写闭环（enumerated）", async () => {
  // 预置设备寄存器 0x0001 = 0xABCD。
  await page.evaluate(() => {
    const fake = (window as unknown as { __mamepFakeSerial: FakeSerialApi })
      .__mamepFakeSerial;
    fake.setRegister(0x0001, 0xabcd);
  });

  const modal = page.locator(".ant-modal-container:visible");
  // 端口刷新须限定在 Port 表单项内（连接对象配置分组已移除）。
  const portField = modal.locator(".ant-form-item").filter({ hasText: "Port" });
  const portSelect = portField.locator(".ant-select");
  const portRefresh = portField.locator('button[title="Refresh"]');
  // 触发刷新重新枚举并解析为可用端口（下拉框出现选项）；`force: true` 见上。
  await portRefresh.click({ force: true });
  await page.waitForFunction(() => {
    const fake = (window as unknown as { __mamepFakeSerial: FakeSerialApi })
      .__mamepFakeSerial;
    return fake.hasPendingRequest();
  });
  await page.evaluate(() => {
    (
      window as unknown as { __mamepFakeSerial: FakeSerialApi }
    ).__mamepFakeSerial.resolveRequest();
  });
  // 等待枚举结果渲染进下拉选项（loading 结束、选项就绪）后再打开下拉框。
  await page.waitForTimeout(400);

  // 打开端口下拉框并选择端口 → 端口标签出现。
  // 注：antd v6 Select 无 .ant-select-selector 类，点击根元素 .ant-select 打开下拉；
  // 虚拟列表下可见选项类为 .ant-select-item-option（role="option" 仅存在于隐藏的无障碍列表）。
  // 点开下拉框会再次触发枚举（requestPort 挂起）：先解析它，确保选择走已授权快照路径。
  await portSelect.click({ force: true });
  await page.waitForFunction(() => {
    const fake = (window as unknown as { __mamepFakeSerial: FakeSerialApi })
      .__mamepFakeSerial;
    return fake.hasPendingRequest();
  });
  await page.evaluate(() => {
    (
      window as unknown as { __mamepFakeSerial: FakeSerialApi }
    ).__mamepFakeSerial.resolveRequest();
  });
  const option = page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: "USB 1234:5678" });
  await option.waitFor({ state: "visible", timeout: 8000 });
  await option.click();
  await expect(modal).toContainText("USB 1234:5678", { timeout: 8000 });

  // Connect：连接成功 → 弹窗关闭，顶栏 Online。
  await modal.locator(".ant-btn").filter({ hasText: "Connect" }).click();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 8000,
  });
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);

  // 首行填入地址 0001。
  const addressInput = page.getByLabel("Address", { exact: true }).first();
  await addressInput.click();
  await addressInput.fill("0001");
  await addressInput.press("Enter");

  // FC03 单行读：Data 显示 ABCD（hex）。
  await page
    .getByRole("button", { name: "Read", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByLabel("Data").first()).toHaveText("ABCD", {
    timeout: 8000,
  });

  // FC10 单行写：12AB 写入设备寄存器（写后由 fake 设备寄存器回读确认）。
  const dataInput = page.getByLabel("Data").first();
  await dataInput.click();
  await dataInput.fill("12AB");
  await dataInput.press("Enter");
  await page
    .getByRole("button", { name: "Write", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (
          window as unknown as { __mamepFakeSerial: FakeSerialApi }
        ).__mamepFakeSerial.getRegister(0x0001),
      ),
    )
    .toBe(0x12ab);
});

test("范围行：多寄存器读/写闭环（ADR-030）", async () => {
  // 预置设备寄存器 0x0001 / 0x0002。
  await page.evaluate(() => {
    const fake = (window as unknown as { __mamepFakeSerial: FakeSerialApi })
      .__mamepFakeSerial;
    fake.setRegister(0x0001, 0x1111);
    fake.setRegister(0x0002, 0x2222);
  });

  // 首行地址改为范围 "0001-0002"（DEC 表），展开箭头出现。
  const addressInput = page.getByLabel("Address", { exact: true }).first();
  await addressInput.click();
  await addressInput.fill("0001-0002");
  await addressInput.press("Enter");
  const firstRow = page
    .locator(
      ".register-table-tabs .ant-tabs-content-active .ant-table-tbody tr[data-row-key]",
    )
    .first();
  await expect(
    firstRow.locator('button[aria-label="Expand row"]'),
  ).toBeVisible();
  await firstRow.locator('button[aria-label="Expand row"]').click();

  // 多寄存器读（FC03 quantity=2）：父行组合值 + 子行各值。
  await page
    .getByRole("button", { name: "Read", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByLabel("Data").first()).toHaveText("1111 2222", {
    timeout: 8000,
  });
  const childDatas = await page.$$eval(
    '.register-table-tabs .ant-tabs-content-active .ant-table-tbody tr[data-row-key*=":c"]',
    (trs) =>
      trs.map((tr) =>
        (
          Array.from(tr.querySelectorAll("td"))[7] as HTMLElement | undefined
        )?.textContent?.trim(),
      ),
  );
  expect(childDatas).toEqual(["1111", "2222"]);

  // 多寄存器写（FC0x10 quantity=2 + 写后回读）：写入 fake 设备寄存器。
  const dataInput = page.getByLabel("Data").first();
  await dataInput.click();
  await dataInput.fill("AAAA BBBB");
  await dataInput.press("Enter");
  await page
    .getByRole("button", { name: "Write", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const fake = (window as unknown as { __mamepFakeSerial: FakeSerialApi })
          .__mamepFakeSerial;
        return [fake.getRegister(0x0001), fake.getRegister(0x0002)];
      }),
    )
    .toEqual([0xaaaa, 0xbbbb]);
});

test("无 console 错误（含 CSP 违规、antd 弃用）", async () => {
  expect(consoleErrors).toEqual([]);
});
