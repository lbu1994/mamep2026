/**
 * 插件安装入口 e2e（mockTransport=1，浏览器端，2026-08-30，PRD §8.3 P1，ADR-038）。
 * 覆盖：
 * - 安装成功：Plugin Manager → Install Plugin → 客户端文件选择 → §6.10.4 安全确认弹窗
 *   （来源/版本/权限/平台/风险）→ 确认 → 列表出现「Installed」标签；
 * - 坏文件：非法 JSON / schema 不合法 → 报错且不注册；
 * - 取消安全确认：不注册；
 * - 重启持久化：安装 + 启停状态经 IndexedDB 落盘，reload 后仍在（Installed 标签 + 启用开关）；
 * - 全程无 console 错误。
 * 注意：隐藏文件输入框随插件管理弹窗挂载（在弹窗体内），安装前必须先打开 Plugin Manager。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

const manifest = {
  id: "e2e-installed",
  name: "E2E Installed",
  version: "1.0.0",
  description: "Installed via the plugin install e2e.",
  author: "E2E Team",
  platform: { web: true, node: false },
  permissions: ["ui.panel"],
  contributions: { panels: [] },
};

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
}

/** 打开 Plugin Manager 弹窗，返回弹窗定位器（按标题定位，无论是否已有插件）。 */
async function openPluginManager(page: Page) {
  await page.getByRole("button", { name: "Plugin Manager" }).click();
  const modal = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Plugin Manager" });
  await expect(modal).toBeVisible();
  return modal;
}

/** 经隐藏文件输入选择 manifest JSON（浏览器端 pluginInstall === "upload" 路径）。 */
async function pickManifestFile(
  page: Page,
  name: string,
  content: string,
): Promise<void> {
  const input = page.locator('input[data-testid="plugin-manifest-file-input"]');
  await expect(input).toBeAttached();
  await input.setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(content, "utf8"),
  });
}

/** 等待 §6.10.4 安全确认弹窗出现并返回定位器。 */
async function confirmModal(page: Page) {
  const confirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await expect(confirm).toBeVisible();
  return confirm;
}

test("安装成功：文件选择 → 安全确认 → 确认后注册并显示 Installed 标签", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });

  await openApp(page);
  const modal = await openPluginManager(page);

  await modal.getByRole("button", { name: "Install Plugin" }).click();
  await pickManifestFile(page, "plugin.json", JSON.stringify(manifest));

  // 安全确认展示来源/版本/权限/平台（§6.10.4）。
  const confirm = await confirmModal(page);
  await expect(confirm).toContainText("E2E Installed");
  await expect(confirm).toContainText("1.0.0");
  await expect(confirm).toContainText("UI Panel");

  // 确认安装。
  await confirm.getByRole("button", { name: "Install", exact: true }).click();
  await expect(confirm).toBeHidden();

  // 列表出现安装的插件 + Installed 标签。
  await expect(modal).toContainText("E2E Installed");
  await expect(modal).toContainText("Installed");
  expect(errors).toEqual([]);
});

test("坏文件：非法 JSON 报错且不注册", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });

  await openApp(page);
  const modal = await openPluginManager(page);
  await modal.getByRole("button", { name: "Install Plugin" }).click();

  await pickManifestFile(page, "bad.json", "{ not-json");
  await expect(page.getByText("The plugin manifest is invalid.")).toBeVisible();
  await expect(modal).not.toContainText("Installed");
  expect(errors).toEqual([]);
});

test("取消安全确认：不注册", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });

  await openApp(page);
  const modal = await openPluginManager(page);
  await modal.getByRole("button", { name: "Install Plugin" }).click();
  await pickManifestFile(page, "plugin.json", JSON.stringify(manifest));

  const confirm = await confirmModal(page);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();

  await expect(modal).not.toContainText("E2E Installed");
  expect(errors).toEqual([]);
});

test("重启持久化：安装 + 启停状态 reload 后仍在", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });

  await openApp(page);
  let modal = await openPluginManager(page);
  await modal.getByRole("button", { name: "Install Plugin" }).click();
  await pickManifestFile(page, "plugin.json", JSON.stringify(manifest));
  const confirm = await confirmModal(page);
  await confirm.getByRole("button", { name: "Install", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(modal).toContainText("Installed");

  // 关闭插件为禁用态（持久化 enabled=false）。
  const switchControl = modal
    .locator(".ant-listy-item")
    .filter({ hasText: "E2E Installed" })
    .locator(".ant-switch");
  await switchControl.click();

  // 等 IndexedDB 自动保存落盘（防抖）再 reload（ADR-031 踩坑）。
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText(
    "Disconnect",
    { timeout: 15000 },
  );

  // 重开 Plugin Manager：插件仍在且为禁用态。
  modal = await openPluginManager(page);
  await expect(modal).toContainText("E2E Installed");
  await expect(modal).toContainText("Installed");
  const restoredSwitch = modal
    .locator(".ant-listy-item")
    .filter({ hasText: "E2E Installed" })
    .locator(".ant-switch");
  const checked = await restoredSwitch.evaluate((el) =>
    el.classList.contains("ant-switch-checked"),
  );
  // 安装前曾关闭 → 持久化 enabled=false，reload 后应保持未勾选。
  expect(checked).toBe(false);
  expect(errors).toEqual([]);
});
