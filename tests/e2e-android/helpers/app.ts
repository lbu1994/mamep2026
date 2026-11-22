/**
 * Android e2e 公共辅助（新增）。
 *
 * 与 `tcp-loop.spec.ts` 中内联的实现**语义一致**，只是抽出来供新的 RTU 用例复用；
 * 既有 TCP 用例保持原样（已全绿，不做无谓改动）。
 */
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import {
  CDP_PORT,
  clearAppData,
  forceStopApp,
  forwardDevtools,
  installApk,
  launchApp,
  removeAllForwards,
  removeAllReverses,
  requireDevice,
  waitForWebviewSocket,
} from "./adb";

export interface AppSession {
  browser: Browser;
  page: Page;
  consoleErrors: string[];
  /** 关闭 CDP 连接、撤销 adb 转发并停掉应用。 */
  close(): Promise<void>;
}

/**
 * 安装并启动应用，接上 WebView 的 CDP 通道，返回可直接断言的 page。
 * 不做 `adb reverse`（RTU 用例不需要；TCP 用例自行调用）。
 */
export async function openAppSession(): Promise<AppSession> {
  requireDevice();
  installApk();
  // 清空应用数据 → 干净工作区（避免跨运行残留的 profile/插件状态污染断言）。
  clearAppData();
  forceStopApp();
  launchApp();

  const socket = await waitForWebviewSocket();
  forwardDevtools(socket, CDP_PORT);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0];
  if (context === undefined) throw new Error("CDP 未返回 WebView context");
  const page = context.pages()[0] ?? (await context.waitForEvent("page"));

  const consoleErrors: string[] = [];
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

  return {
    browser,
    page,
    consoleErrors,
    close: async () => {
      await browser.close();
      removeAllForwards();
      removeAllReverses();
      forceStopApp();
    },
  };
}

/** 收起启动时自动弹出的 Connection Settings（不连接，只关弹窗，供后续用例交互）。 */
export async function dismissConnectionSettings(page: Page): Promise<void> {
  const modal = page.locator(".ant-modal-container:visible");
  if ((await modal.count()) === 0) return;
  try {
    // 语言无关：连接弹窗 footer 为 [Cancel, CONNECT]（ConnectionSettingsModal），
    // 故取 footer 第一个按钮，不用英文按钮名（界面语言随工作区偏好会变）。
    await modal
      .locator(".ant-modal-footer button")
      .first()
      .click({ timeout: 15_000 });
  } catch {
    // 兜底：antd Modal 默认可 Esc 关闭。
    await page.keyboard.press("Escape");
  }
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);
}

/** 首行填地址（默认表行地址为空，不填则读请求不会生成：RegisterTableService 直接报地址为空）。 */
export async function setRowAddress(
  page: Page,
  address: string,
): Promise<void> {
  // 注意：不能用 /^Address/ 正则——会匹配到工具栏「Address format」进制切换控件与「Address Adjust」控件。
  const cell = page.getByLabel("Address", { exact: true }).first();
  await cell.click();
  const input = page.getByLabel("Address", { exact: true }).first();
  await expect(input).toBeEditable({ timeout: 10_000 });
  // fill() 用原生 value setter 设置 DOM 值，React onChange 可能不触发（仓库既有踩坑）：
  // 用 pressSequentially 逐字符输入（真实键盘事件），确认受控值同步后再 Enter 提交。
  await input.fill("");
  await input.pressSequentially(address, { delay: 10 });
  await expect(input).toHaveValue(address);
  await input.press("Enter");
}

/** 首行点击 Read。 */
export async function readRow(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Read", exact: true })
    .first()
    .evaluate((element) => (element as HTMLElement).click());
}

/** 首行填 Data（HEX）并点击 Write。 */
export async function writeRow(page: Page, valueHex: string): Promise<void> {
  const cell = page.getByLabel("Data", { exact: true }).first();
  await cell.click();
  const input = page.getByLabel("Data", { exact: true }).first();
  await expect(input).toBeEditable({ timeout: 10_000 });
  await input.fill("");
  await input.pressSequentially(valueHex, { delay: 10 });
  await expect(input).toHaveValue(valueHex);
  await input.press("Enter");
  await page
    .getByRole("button", { name: "Write", exact: true })
    .first()
    .evaluate((element) => (element as HTMLElement).click());
}

/** 切换当前表的写后回读配置；配置位于 Table settings 面板。 */
export async function setWriteVerify(
  page: Page,
  optionText: string,
): Promise<void> {
  const settingsButton = page.getByRole("button", {
    name: "Table settings",
    exact: true,
  });
  const settingsPanel = page.locator(".table-toolbar__settings");
  if (!(await settingsPanel.isVisible())) {
    await settingsButton.click();
  }
  await expect(settingsPanel).toBeVisible({ timeout: 5000 });

  const verify = settingsPanel.locator(".table-toolbar__verify");
  await verify.getByLabel("Write verification").click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: new RegExp(`^${optionText}$`) })
    .first()
    .click();
  await expect(verify).toContainText(optionText, { timeout: 5000 });

  await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
  await expect(settingsPanel).toBeVisible();
  await settingsButton.click();
  await expect(settingsPanel).toBeHidden({ timeout: 5000 });
}

/** 会话设置弹窗（启动时自动打开）。 */
export function connectionModal(page: Page) {
  return page.locator(".ant-modal-container");
}

/** 在弹窗内切到 Modbus RTU（协议分组仅在两种协议都支持时渲染）。 */
export async function selectRtuProtocol(page: Page): Promise<void> {
  await connectionModal(page)
    .getByText("Modbus RTU", { exact: true })
    .first()
    .click();
  await page.waitForTimeout(300);
}

/** 在弹窗内切到 Modbus TCP。 */
export async function selectTcpProtocol(page: Page): Promise<void> {
  await connectionModal(page)
    .getByText("Modbus TCP", { exact: true })
    .first()
    .click();
  await page.waitForTimeout(300);
}

/**
 * RTU 表单里的串口下拉（serialPorts: "enumerated" 分支）。
 * 注意：antd Select 非 search 模式下 placeholder 渲染为 span（不在 input 上），
 * 因此按 Form.Item 的 label 精确文本定位，而非 placeholder。
 */
export function serialPortSelect(page: Page) {
  return connectionModal(page)
    .locator(".ant-form-item")
    .filter({ hasText: "Port" })
    .locator(".ant-select")
    .first();
}

/** 打开串口下拉并返回下拉面板。 */
export async function openSerialPortDropdown(page: Page) {
  await serialPortSelect(page).click();
  const dropdown = page.locator(".ant-select-dropdown:visible").last();
  await expect(dropdown).toBeVisible({ timeout: 15_000 });
  return dropdown;
}

/** 点击弹窗内 CONNECT。 */
export async function clickConnect(page: Page): Promise<void> {
  await connectionModal(page)
    .locator(".ant-btn")
    .filter({ hasText: "CONNECT" })
    .click();
}
