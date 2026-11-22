/**
 * 可执行插件（单文件 JS）e2e（mockTransport=1，浏览器端）。
 * 覆盖：
 * - 安装单文件 JS 插件：真实 Web Worker 加载 entry → 提取 manifest → 安全确认
 *   （含「Isolated worker」运行位置）→ 注册并激活（隔离线程执行 activate）；
 * - 重启持久化：entrySource 经 IndexedDB 落盘，reload 后恢复并重新激活；
 * - 卸载：确认后移除 + reload 不再出现；
 * - 激活失败隔离：entry activate 抛错 → 插件可见但不崩溃（无 console 错误）。
 * 全程无 console 错误。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

/** 自包含单文件 JS 插件（ESM：manifest + activate）。 */
const ENTRY_OK = `
export const manifest = {
  id: "e2e-exec",
  name: "E2E Exec",
  version: "1.0.0",
  apiVersion: "2.0",
  description: "Runs in an isolated worker.",
  author: "E2E Team",
  platform: { web: true, node: false },
  permissions: ["communication"],
  contributes: {},
};
export async function activate(ctx) {
  try {
    await ctx.communication.readRegisters({ address: 0, quantity: 1 });
  } catch (err) {
    /* 未连接时读请求降级为能力错误，插件仍激活成功。 */
  }
}
export function deactivate() {}
`;

/** activate 抛错的插件（错误隔离：插件 failed，核心不崩溃）。 */
const ENTRY_THROW = `
export const manifest = {
  id: "e2e-throw",
  name: "E2E Throw",
  version: "1.0.0",
  apiVersion: "2.0",
  description: "Throws during activate.",
  author: "E2E Team",
  platform: { web: true, node: false },
  permissions: [],
  contributes: {},
};
export function activate() {
  throw new Error("activate boom");
}
`;

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
}

/** 打开 Settings 抽屉的 Plugins 页签，返回插件管理区块定位器
 * （插件管理由独立弹窗并入 Settings）。 */
async function openPluginManager(page: Page) {
  if ((await page.locator(".settings-drawer.ant-drawer-open").count()) === 0) {
    await page
      .getByRole("button", { name: "Settings", exact: true })
      .evaluate((el) => (el as HTMLElement).click());
    await page.waitForSelector(".settings-drawer.ant-drawer-open", {
      timeout: 5000,
    });
  }
  await page
    .locator(".settings-drawer")
    .getByRole("tab", { name: "Plugins" })
    .click();
  const section = page.getByTestId("plugin-manager");
  await expect(section).toBeVisible();
  return section;
}

/** 经隐藏文件输入选择单文件 JS 插件（浏览器端 pluginInstall === "upload" 路径）。 */
async function pickPluginSource(
  page: Page,
  name: string,
  content: string,
): Promise<void> {
  const input = page.locator('input[data-testid="plugin-manifest-file-input"]');
  await expect(input).toBeAttached();
  await input.setInputFiles({
    name,
    mimeType: "text/javascript",
    buffer: Buffer.from(content, "utf8"),
  });
}

test("安装单文件 JS 插件：隔离线程加载 manifest → 确认（Isolated worker）→ 注册激活", async ({
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
  await pickPluginSource(page, "plugin.mjs", ENTRY_OK);

  // 安全确认展示执行模式选择（默认隔离线程）。
  const confirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("E2E Exec");
  await expect(confirm).toContainText("Isolated worker (recommended)");
  await expect(confirm).toContainText(
    "Same process (required for sync capabilities)",
  );

  // 确认安装 → 列表出现 + Installed 标签。
  await confirm.getByRole("button", { name: "Install", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(modal).toContainText("E2E Exec");
  await expect(modal).toContainText("Installed");
  expect(errors).toEqual([]);
});

test("重启持久化：entrySource 落盘，reload 后恢复并重新激活", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });

  await openApp(page);
  let modal = await openPluginManager(page);
  await modal.getByRole("button", { name: "Install Plugin" }).click();
  await pickPluginSource(page, "plugin.mjs", ENTRY_OK);
  const confirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Install", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(modal).toContainText("E2E Exec");

  // 等 IndexedDB 自动保存落盘（防抖）再 reload（踩坑）。
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });

  // 重开 Settings → Plugins：插件仍在（entrySource 恢复），且可卸载（installed）。
  modal = await openPluginManager(page);
  await expect(modal).toContainText("E2E Exec");
  await expect(modal).toContainText("Installed");
  const row = modal.locator(".ant-listy-item").filter({ hasText: "E2E Exec" });
  await expect(row.locator('button[aria-label="Uninstall"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("卸载可执行插件：确认后移除，reload 不再出现", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });

  await openApp(page);
  let modal = await openPluginManager(page);
  await modal.getByRole("button", { name: "Install Plugin" }).click();
  await pickPluginSource(page, "plugin.mjs", ENTRY_OK);
  const confirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Install", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(modal).toContainText("E2E Exec");

  // 卸载。
  const row = modal.locator(".ant-listy-item").filter({ hasText: "E2E Exec" });
  await row.locator('button[aria-label="Uninstall"]').click();
  const uninstallConfirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Uninstall this plugin?" });
  await expect(uninstallConfirm).toBeVisible();
  await uninstallConfirm
    .getByRole("button", { name: "Uninstall", exact: true })
    .click();
  await expect(uninstallConfirm).toBeHidden();
  await expect(modal).not.toContainText("E2E Exec");

  // 等自动保存落盘再 reload → 不再出现。
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
  modal = await openPluginManager(page);
  await expect(modal).not.toContainText("E2E Exec");
  expect(errors).toEqual([]);
});

test("激活失败隔离：entry activate 抛错 → 插件可见但不崩溃（无 console 错误）", async ({
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
  await pickPluginSource(page, "throw.mjs", ENTRY_THROW);
  const confirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Install", exact: true }).click();
  await expect(confirm).toBeHidden();

  // 插件注册（即使激活失败也可见于列表），应用保持可用。
  await expect(modal).toContainText("E2E Throw");
  expect(errors).toEqual([]);
});
