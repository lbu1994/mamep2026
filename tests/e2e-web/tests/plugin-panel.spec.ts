/**
 * panels 贡献示例插件 e2e（mockTransport=1，浏览器端）。
 *
 * 覆盖：
 * - 安装 `example-panel`（纯清单 manifest，`ui-contribution` 权限）→ 底部面板出现「Plugins」页签，
 *   页签内渲染面板区块（标题 + 占位内容）；
 * - 卸载后贡献回收 → 底部面板的「Plugins」页签消失；
 * - 全程无 console 错误。
 *
 * 注意：跑前需 `pnpm build:plugins`（产物 `release/plugins/example-panel/manifest.json`）；
 * `pnpm test:e2e:web` / `test:e2e:vscode` 已自动先构建。
 * 标题解析优先级（插件自带 `title` → 英文 → 应用 i18n `titleKey`）由单测覆盖
 * （`packages/ui/src/plugin/plugin-title.test.ts`、`plugin-contributions.test.tsx`），
 * 本 spec 负责「贡献 → 界面接线」的端到端验证。
 */
import { expect, test, type Page } from "@playwright/test";
import {
  closeSettings,
  installPluginFile,
  openPluginsSection,
  pluginArtifact,
} from "./helpers/manual-plugins";

const BASE_URL = "http://localhost:5173/?mockTransport=1";
const PLUGIN_NAME = "Example Panel";

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 显示 Online 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
  return errors;
}

/** 底部面板的「Plugins」页签（必须限定 `.bottom-panel`：Settings 抽屉内也有同名页签）。 */
function bottomPluginsTab(page: Page) {
  return page.locator(".bottom-panel").getByRole("tab", { name: "Plugins" });
}

/** 安装示例插件（纯清单 manifest 产物）。 */
async function installExamplePanel(page: Page): Promise<void> {
  await installPluginFile(page, {
    filePath: pluginArtifact("example-panel", "manifest.json"),
    pluginName: PLUGIN_NAME,
  });
}

test("安装示例插件：底部面板出现 Plugins 页签并渲染面板", async ({ page }) => {
  const errors = await openApp(page);

  // 无面板贡献时底部面板没有「Plugins」页签。
  await expect(bottomPluginsTab(page)).toHaveCount(0);

  await installExamplePanel(page);

  // 安装后底部面板出现「Plugins」页签（点击页签同时展开面板）。
  await expect(bottomPluginsTab(page)).toHaveCount(1);
  await bottomPluginsTab(page).click();

  const panels = page.locator('.bottom-panel [data-testid="plugin-panels"]');
  await expect(panels).toBeVisible();
  await expect(panels).toContainText(PLUGIN_NAME);
  // 占位内容（交互式面板组件机制属）。
  await expect(panels).toContainText(
    "Plugin panel content will be provided by the plugin runtime.",
  );

  expect(errors).toEqual([]);
});

test("卸载示例插件：Plugins 页签随之消失", async ({ page }) => {
  const errors = await openApp(page);
  await installExamplePanel(page);
  await expect(bottomPluginsTab(page)).toHaveCount(1);

  // 卸载（Settings → Plugins → Uninstall → 确认）。
  const section = await openPluginsSection(page);
  const row = section
    .locator(".ant-listy-item")
    .filter({ hasText: PLUGIN_NAME });
  await row.locator('button[aria-label="Uninstall"]').click();
  const confirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Uninstall this plugin?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Uninstall", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(section).not.toContainText(PLUGIN_NAME);
  await closeSettings(page);

  // 贡献回收 → 页签消失。
  await expect(bottomPluginsTab(page)).toHaveCount(0);

  expect(errors).toEqual([]);
});
