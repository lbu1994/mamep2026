/**
 * Electron 三端运行骨架 E2E（ADR-016 后续事项的正式测试，冒烟脚本 scripts/smoke-electron.mjs 的升级）。
 * 生产构建路径启动：dist-electron/main.js + apps/web/dist-electron/（loadFile，验证 base ./ + CSP）。
 * 覆盖：共享 UI 加载、preload 白名单桥、能力如实声明、debug 探针、剪贴板往返、
 * Renderer 安全边界、无 console 错误、关闭窗口干净退出。
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

const require = createRequire(import.meta.url);
/** 仓库根目录（本文件位于 tests/e2e-electron/tests/）。 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** preload 白名单桥的调用面（用于安全边界断言与类型化调用）。 */
interface BridgeApi {
  platform: string;
  getCapabilities(): Promise<{
    ok: boolean;
    value?: { modbusRtu?: boolean; modbusTcp?: boolean; serialPorts?: string };
    error?: { code?: string };
  }>;
  getAppVersion(): Promise<{ ok: boolean; value?: string; error?: { code?: string } }>;
  copyTextToClipboard(text: string): Promise<{ ok: boolean }>;
  readTextFromClipboard(): Promise<{ ok: boolean; value?: string | null }>;
  getDebugState(): Promise<{
    ok: boolean;
    value?: { windowCount?: number; connectionState?: string };
    error?: { code?: string };
  }>;
  onEvent(listener: (event: unknown) => void): () => void;
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
  await page.waitForLoadState("domcontentloaded");
  // 给 React 挂载留出时间。
  await page.waitForTimeout(1500);
});

test.afterAll(async () => {
  try {
    await app.close();
  } catch {
    // 已在「关闭窗口干净退出」用例中关闭。
  }
});

test("窗口加载同一套共享 UI 且 preload 白名单桥存在", async () => {
  expect(await page.locator("#root > *").count()).toBeGreaterThan(0);
  const bridgePresent = await page.evaluate(
    () =>
      typeof (window as unknown as { mamepHost?: unknown }).mamepHost !==
      "undefined",
  );
  expect(bridgePresent).toBe(true);
});

test("能力如实声明（RTU 支持、串口 enumerated 下拉选择、TCP 不支持）且版本可读", async () => {
  const caps = await page.evaluate(async () => {
    const bridge = (window as unknown as { mamepHost: BridgeApi }).mamepHost;
    return bridge.getCapabilities();
  });
  expect(caps.ok).toBe(true);
  expect(caps.value?.modbusRtu).toBe(true);
  expect(caps.value?.modbusTcp).toBe(false);
  expect(caps.value?.serialPorts).toBe("enumerated");

  const version = await page.evaluate(async () => {
    const bridge = (window as unknown as { mamepHost: BridgeApi }).mamepHost;
    return bridge.getAppVersion();
  });
  expect(version.ok).toBe(true);
  expect(typeof version.value).toBe("string");
});

test("debug 探针与剪贴板往返可用", async () => {
  const dbg = await page.evaluate(async () => {
    const bridge = (window as unknown as { mamepHost: BridgeApi }).mamepHost;
    return bridge.getDebugState();
  });
  expect(dbg.ok).toBe(true);
  expect(dbg.value?.windowCount ?? 0).toBeGreaterThanOrEqual(1);
  expect(dbg.value?.connectionState).toBe("disconnected");

  const copy = await page.evaluate(async () => {
    const bridge = (window as unknown as { mamepHost: BridgeApi }).mamepHost;
    return bridge.copyTextToClipboard("e2e-electron-20260821");
  });
  expect(copy.ok).toBe(true);
  const read = await page.evaluate(async () => {
    const bridge = (window as unknown as { mamepHost: BridgeApi }).mamepHost;
    return bridge.readTextFromClipboard();
  });
  expect(read.ok).toBe(true);
  expect(read.value).toBe("e2e-electron-20260821");
});

test("Renderer 安全边界：无 Node 权限、桥仅白名单方法", async () => {
  expect(
    await page.evaluate(() => typeof window.require),
  ).toBe("undefined");
  expect(
    await page.evaluate(() => typeof (window as unknown as { process?: unknown }).process),
  ).toBe("undefined");

  const keys = await page.evaluate(() =>
    Object.keys(
      (window as unknown as { mamepHost?: Record<string, unknown> }).mamepHost ??
        {},
    ),
  );
  expect(keys.sort()).toEqual(
    [
      "platform",
      "getCapabilities",
      "getAppVersion",
      "copyTextToClipboard",
      "readTextFromClipboard",
      "selectSerialPort",
      "onEvent",
      "getDebugState",
    ].sort(),
  );
  // 不暴露通用 ipcRenderer / 任意方法调用。
  expect(keys).not.toContain("ipcRenderer");
  expect(keys).not.toContain("invoke");
});

test("无 console 错误（含 CSP 违规、antd 弃用）", async () => {
  expect(consoleErrors).toEqual([]);
});

test("关闭窗口后应用干净退出（window-all-closed -> quit）", async () => {
  const closed = new Promise<void>((resolve) => {
    app.on("close", () => resolve());
  });
  await page.close();
  await closed;
});
