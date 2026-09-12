/**
 * Electron 宿主侧插件执行面 e2e（ADR-055，2026-09-12）。
 *
 * 验证 Electron 端「插件一律手动安装 + 同进程执行」在**主进程**的真实闭环：
 * - 经 Settings → Plugins → Install Plugin 安装 `pnpm build:plugins` 产出的可执行插件
 *   （address-adjust，manifest 经主进程 open-text-file 读取；对话框由 electronApp.evaluate 桩替换）；
 * - 确认框中显式授权「同进程执行」（Same process）→ 渲染端 `plugin-store-save` → 主进程
 *   `plugins.json` 原子落盘（断言文件内容含 executionMode/entrySource）；
 * - 主进程侧插件执行面随之同步（`onPluginStoreSaved` → HostPluginRuntime.sync）：插件被主进程加载
 *   并注册同步能力（变换/ codec 由 platform-node 单测覆盖加载与注册细节）；
 * - 关闭 → 同 userData 重启 → 插件仍在（渲染端从同一份 plugins.json hydrate；主进程启动即 sync）；
 * - 卸载 → plugins.json 清空（宿主执行面随之注销）；
 * - 全程无 console 错误。
 *
 * 说明（ADR-055 已知限制）：Electron 的 RTU 会话在 Renderer（ADR-017）、TCP 不应用地址变换
 * （ADR-022/042），故宿主插件变换当前在 Electron 无用户可见路径；本 spec 验证**执行面装配与
 * 生命周期**（加载/持久化/重启/卸载），宿主插件**生效路径**的端到端证据由 VSCode
 * （`tests/e2e-vscode` runPluginHostLoop，RTU 会话在 Extension Host）提供。
 */
import {
  _electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** 插件产物（`pnpm build:plugins` 输出；见 scripts/build-plugins.mjs）。 */
const PLUGIN_ID = "builtin-address-adjust";
const PLUGIN_ENTRY_PATH = path.resolve(
  REPO_ROOT,
  "release/plugins",
  PLUGIN_ID,
  `${PLUGIN_ID}.mjs`,
);

let userDataDir = "";
let app: ElectronApplication;
let page: Page;
const consoleErrors: string[] = [];

async function launch(userDataDirPath: string): Promise<void> {
  app = await _electron.launch({
    executablePath: require("electron"),
    args: ["dist-electron/main.js"],
    cwd: REPO_ROOT,
    env: { ...process.env, MAMEP_USER_DATA_DIR: userDataDirPath },
  });
  page = await app.firstWindow();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  // 关闭启动弹出的 Connection Settings（本 spec 不连接设备），避免遮罩拦截点击。
  await page.waitForSelector(".ant-modal-container:visible", { timeout: 15000 });
  await page.waitForTimeout(1000);
  await page
    .locator(".ant-modal-container:visible .ant-modal-close")
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);
}

test.beforeAll(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), "mamep-plugin-host-"));
  // 系统对话框不可自动化：主进程 dialog.showOpenDialog 桩 → 插件产物路径。
  await launch(userDataDir);
  await app.evaluate(
    async ({ dialog }, entryPath) => {
      (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog =
        async () => ({ canceled: false, filePaths: [entryPath] });
    },
    PLUGIN_ENTRY_PATH,
  );
});

test.afterAll(async () => {
  try {
    await app.close();
  } catch {
    // 已关闭。
  }
  await rm(userDataDir, { recursive: true, force: true });
});

/** 打开 Settings 抽屉的 Plugins 页签。 */
async function openPluginsSection() {
  await page
    .getByRole("button", { name: "Settings" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".settings-drawer.ant-drawer-open", {
    timeout: 5000,
  });
  await page
    .locator(".settings-drawer")
    .getByRole("tab", { name: "Plugins" })
    .click();
  const section = page.getByTestId("plugin-manager");
  await expect(section).toBeVisible();
  return section;
}

async function closeSettings(): Promise<void> {
  await page
    .locator(".settings-drawer .ant-drawer-close")
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(
    page.locator(".settings-drawer .ant-drawer-content-wrapper"),
  ).toBeHidden();
}

test("安装同进程可执行插件 → 主进程 plugins.json 落盘（含 executionMode/entrySource）", async () => {
  const section = await openPluginsSection();
  await section.getByRole("button", { name: "Install Plugin" }).click();

  // manifest 经主进程 open-text-file（对话框已桩替换为插件产物路径）。
  const confirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await expect(confirm).toBeVisible({ timeout: 10000 });
  // 执行模式：显式授权「同进程执行」（隔离线程无法贡献同步能力）。
  await confirm.getByText("Same process", { exact: false }).click();
  await confirm.getByRole("button", { name: "Install", exact: true }).click();
  await expect(confirm).toBeHidden({ timeout: 10000 });
  await expect(section).toContainText("Address Adjust", { timeout: 10000 });
  await closeSettings();

  // 主进程 plugins.json 原子落盘：插件记录含 entrySource + executionMode。
  await expect
    .poll(async () => {
      try {
        return await readFile(path.join(userDataDir, "plugins.json"), "utf8");
      } catch {
        return "";
      }
    }, { timeout: 10000 })
    .toContain(PLUGIN_ID);
  const stored = JSON.parse(
    await readFile(path.join(userDataDir, "plugins.json"), "utf8"),
  ) as {
    schemaVersion: number;
    plugins: Array<{
      enabled: boolean;
      executionMode?: string;
      entrySource?: string;
    }>;
  };
  expect(stored.schemaVersion).toBe(4);
  expect(stored.plugins).toHaveLength(1);
  expect(stored.plugins[0]?.executionMode).toBe("same-process");
  expect(stored.plugins[0]?.enabled).toBe(true);
  expect(stored.plugins[0]?.entrySource ?? "").toContain("activate");
});

test("重启（同 userData）→ 插件仍在（主进程按 plugins.json 重建宿主执行面）", async () => {
  await app.close();
  await launch(userDataDir);
  const section = await openPluginsSection();
  await expect(section).toContainText("Address Adjust", { timeout: 10000 });
  await closeSettings();
});

test("卸载 → plugins.json 清空（宿主侧插件随之注销）", async () => {
  const section = await openPluginsSection();
  // 每行卸载按钮（i18n：Uninstall）。
  await section
    .getByRole("button", { name: "Uninstall" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  const confirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Uninstall this plugin?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Uninstall", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(section).not.toContainText("Address Adjust", { timeout: 10000 });
  await closeSettings();

  await expect
    .poll(async () => {
      try {
        const data = JSON.parse(
          await readFile(path.join(userDataDir, "plugins.json"), "utf8"),
        ) as { plugins: unknown[] };
        return data.plugins.length;
      } catch {
        return -1;
      }
    }, { timeout: 10000 })
    .toBe(0);
});

test("无 console 错误（含 CSP 违规、antd 弃用）", async () => {
  expect(consoleErrors).toEqual([]);
});
