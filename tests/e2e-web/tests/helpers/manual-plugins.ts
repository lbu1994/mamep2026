/**
 * 手动安装插件的 e2e 助手。
 *
 * 插件不再随应用一次性安装：e2e 用例需要先经 Settings → Plugins → Install Plugin 安装
 * `pnpm build:plugins` 产出的插件文件（`release/plugins/<pluginId>/`），
 * 需要贡献同步能力（codec / dataType / addressTransform）的插件必须在安装确认框中选择
 * 「同进程执行」（Same process）——隔离线程无法提供同步纯函数。
 *
 * 注意：运行这些用例前需先执行 `pnpm build:plugins`（产物在 `release/` 下，已 gitignore）。
 */
import path from "node:path";
import { expect, type Page } from "@playwright/test";

/** 仓库根目录（本文件位于 tests/e2e-web/tests/helpers/，上跳四级）。 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** 插件产物路径（`pnpm build:plugins` 输出，见 scripts/build-plugins.mjs）。 */
export function pluginArtifact(pluginId: string, fileName: string): string {
  return path.resolve(REPO_ROOT, "release/plugins", pluginId, fileName);
}

/** 打开 Settings 抽屉的 Plugins 页签，返回插件管理区块定位器。 */
export async function openPluginsSection(page: Page) {
  if ((await page.locator(".settings-drawer.ant-drawer-open").count()) === 0) {
    await page
    .getByRole("button", { name: "Settings", exact: true })
      .evaluate((el) => (el as HTMLElement).click());
    await page.waitForSelector(".settings-drawer.ant-drawer-open", {
      timeout: 15_000,
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

/** 关闭 Settings 抽屉（离场动画期间点击会被遮罩吞掉，故等 wrapper 隐藏）。 */
export async function closeSettings(page: Page): Promise<void> {
  await page
    .locator(".settings-drawer .ant-drawer-close")
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(
    page.locator(".settings-drawer .ant-drawer-content-wrapper"),
  ).toBeHidden();
}

/**
 * 安装插件文件（.json 清单 / .mjs 可执行 entry）。
 * `executionMode` 仅对 `.mjs` 生效：same-process = 在确认框中显式选择「同进程执行」。
 */
export async function installPluginFile(
  page: Page,
  options: {
    filePath: string;
    pluginName: string;
    executionMode?: "isolated" | "same-process";
  },
): Promise<void> {
  const section = await openPluginsSection(page);
  await section.getByRole("button", { name: "Install Plugin" }).click();
  const input = page.locator('input[data-testid="plugin-manifest-file-input"]');
  await expect(input).toBeAttached();
  await input.setInputFiles(options.filePath);

  const confirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await expect(confirm).toBeVisible();
  if (options.executionMode === "same-process") {
    await confirm.getByText("Same process", { exact: false }).click();
  }
  await confirm.getByRole("button", { name: "Install", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(section).toContainText(options.pluginName);
  await closeSettings(page);
}

/** 安装可执行插件产物（`release/plugins/<pluginId>/<pluginId>.mjs`）。 */
export async function installExecutablePlugin(
  page: Page,
  options: {
    pluginId: string;
    pluginName: string;
    executionMode?: "isolated" | "same-process";
  },
): Promise<void> {
  await installPluginFile(page, {
    filePath: pluginArtifact(options.pluginId, `${options.pluginId}.mjs`),
    pluginName: options.pluginName,
    ...(options.executionMode !== undefined
      ? { executionMode: options.executionMode }
      : {}),
  });
}
