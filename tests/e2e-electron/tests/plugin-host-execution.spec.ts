/**
 * Electron 宿主侧插件执行面 e2e。
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
 * 说明（已知限制）：Electron 的 RTU 会话在 Renderer、TCP 不应用地址变换
 * 宿主插件变换当前在 Electron 无用户可见路径；本 spec 验证**执行面装配与
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
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expectNoConsoleErrors } from "../no-console-guard";
import { STORAGE_ATTACK_ENTRY } from "@mamep2026/e2e-fixtures/storage-attack";
import { applicationStorageContent } from "@mamep2026/e2e-fixtures/storage-helpers";

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

test("reports host-only activation failure and recovers through the production bridge", async () => {
  if (await page.locator(".settings-drawer.ant-drawer-open").isVisible())
    await closeSettings();
  const entryPath = path.join(userDataDir, "host-result-fixture.mjs");
  await writeFile(
    entryPath,
    `
export const manifest = {
  id: "host-result-fixture", name: "Host result fixture", version: "1.0.0", apiVersion: "2.0",
  description: "Host result regression", platform: { web: true, node: true }, permissions: [], contributes: {},
  executionRequirements: { version: 1, requiredExecution: "same-process", reason: "Host result regression" },
};
export async function activate() {
  if (typeof process !== "undefined" && process.versions?.node && !globalThis.__hostResultRecovered) {
    throw new Error("Host result fixture unavailable");
  }
}
`,
    "utf8",
  );
  await app.evaluate(async ({ dialog }, sourcePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [sourcePath],
    });
  }, entryPath);
  const section = await openPluginsSection();
  await section.getByRole("button", { name: "Install Plugin" }).click();
  const confirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await confirm
    .getByRole("button", {
      name: "Authorize same-process execution and install",
      exact: true,
    })
    .click();
  await expect(confirm).toBeHidden();
  const state = section.getByTestId("host-plugin-state-host-result-fixture");
  await expect(state).toContainText("Host: failed");
  await expect(state).toContainText("Host result fixture unavailable");
  const before = await readFile(path.join(userDataDir, "plugins.json"), "utf8");
  await app.evaluate(() => {
    Reflect.set(globalThis, "__hostResultRecovered", true);
  });
  await section
    .getByRole("button", { name: "Reload on host", exact: true })
    .click();
  await expect(state).toContainText("Host: active");
  await expect(state).not.toContainText("Host result fixture unavailable");
  expect(await readFile(path.join(userDataDir, "plugins.json"), "utf8")).toBe(
    before,
  );
  const row = section
    .locator(".ant-listy-item")
    .filter({ hasText: "Host result fixture" });
  await row.getByRole("button", { name: "Uninstall", exact: true }).click();
  const uninstall = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Uninstall this plugin?" });
  await uninstall
    .getByRole("button", { name: "Uninstall", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await app.evaluate(async ({ dialog }, sourcePath) => {
    Reflect.deleteProperty(globalThis, "__hostResultRecovered");
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [sourcePath],
    });
  }, PLUGIN_ENTRY_PATH);
  await closeSettings();
});

async function launch(userDataDirPath: string): Promise<void> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") env[key] = value;
  }
  env.MAMEP_USER_DATA_DIR = userDataDirPath;
  app = await _electron.launch({
    executablePath: require("electron"),
    args: ["dist-electron/main.js"],
    cwd: REPO_ROOT,
    env,
  });
  page = await app.firstWindow();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  // 关闭启动弹出的 Connection Settings（本 spec 不连接设备），避免遮罩拦截点击。
  await page.waitForSelector(".ant-modal-container:visible", {
    timeout: 15000,
  });
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
  await app.evaluate(async ({ dialog }, entryPath) => {
    (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog =
      async () => ({ canceled: false, filePaths: [entryPath] });
  }, PLUGIN_ENTRY_PATH);
});

test.afterAll(async () => {
  try {
    await app.close();
  } catch {
    // 已关闭。
  }
  await rm(userDataDir, { recursive: true, force: true });
  expectNoConsoleErrors(consoleErrors);
});

/** 打开 Settings 抽屉的 Plugins 页签。 */
async function openPluginsSection() {
  await page
    .getByRole("button", { name: "Settings", exact: true })
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
  await expect(
    confirm.getByRole("button", {
      name: "Authorize same-process execution and install",
      exact: true,
    }),
  ).toBeVisible();
  await confirm
    .getByRole("button", {
      name: "Authorize same-process execution and install",
      exact: true,
    })
    .click();
  await expect(confirm).toBeHidden({ timeout: 10000 });
  await expect(section).toContainText("Address Adjust", { timeout: 10000 });
  await closeSettings();

  // 主进程 plugins.json 原子落盘：插件记录含 entrySource + executionMode。
  await expect
    .poll(
      async () => {
        try {
          return await readFile(path.join(userDataDir, "plugins.json"), "utf8");
        } catch {
          return "";
        }
      },
      { timeout: 10000 },
    )
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
  expect(stored.schemaVersion).toBe(6);
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
    .poll(
      async () => {
        try {
          const data = JSON.parse(
            await readFile(path.join(userDataDir, "plugins.json"), "utf8"),
          ) as { plugins: unknown[] };
          return data.plugins.length;
        } catch {
          return -1;
        }
      },
      { timeout: 10000 },
    )
    .toBe(0);
});

test("isolated plugin cannot access storage or the preload bridge; file tampering cannot authorize restart", async () => {
  const entryPath = path.join(userDataDir, "storage-isolation.mjs");
  await writeFile(entryPath, STORAGE_ATTACK_ENTRY, "utf8");
  await app.evaluate(async ({ dialog }, selectedPath) => {
    (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog =
      async () => ({ canceled: false, filePaths: [selectedPath] });
  }, entryPath);
  const workspacePath = path.join(userDataDir, "workspace.json");
  await expect
    .poll(async () => readFile(workspacePath, "utf8").catch(() => ""))
    .not.toBe("");
  const workspace = await readFile(workspacePath, "utf8");
  const backupPath = path.join(userDataDir, "workspace.json.bak");
  await writeFile(backupPath, workspace, "utf8");

  const section = await openPluginsSection();
  await section.getByRole("button", { name: "Install Plugin" }).click();
  const dialog = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await expect(dialog).toContainText("Storage isolation regression");
  await dialog
    .getByRole("button", {
      name: "Install",
      exact: true,
    })
    .click();
  await expect(dialog).toBeHidden();
  const row = section
    .locator(".ant-listy-item")
    .filter({ hasText: "Storage isolation regression" });
  await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  const pluginsPath = path.join(userDataDir, "plugins.json");
  await expect
    .poll(async () => readFile(pluginsPath, "utf8"))
    .toContain("storage-isolation-regression");
  const installed = await readFile(pluginsPath, "utf8");
  await app.close();
  await launch(userDataDir);
  const reopened = await openPluginsSection();
  await expect(
    reopened
      .locator(".ant-listy-item")
      .filter({ hasText: "Storage isolation regression" })
      .getByRole("switch"),
  ).toHaveAttribute("aria-checked", "true");
  expect(await readFile(pluginsPath, "utf8")).toBe(installed);
  expect(
    applicationStorageContent({
      workspace: JSON.parse(await readFile(workspacePath, "utf8")),
      "workspace-backup": JSON.parse(await readFile(backupPath, "utf8")),
    }),
  ).toEqual(
    applicationStorageContent({
      workspace: JSON.parse(workspace),
      "workspace-backup": JSON.parse(workspace),
    }),
  );

  await app.close();
  const tampered = JSON.parse(installed) as {
    plugins: Array<{ executionMode: string; entrySource: string }>;
  };
  const record = tampered.plugins[0];
  if (record === undefined) throw new Error("Installed plugin missing");
  record.executionMode = "same-process";
  record.entrySource =
    'document.documentElement.dataset.unapprovedPlugin = "executed";\n' +
    record.entrySource;
  await writeFile(pluginsPath, JSON.stringify(tampered), "utf8");
  await launch(userDataDir);
  const restoredSection = await openPluginsSection();
  const restoredRow = restoredSection
    .locator(".ant-listy-item")
    .filter({ hasText: "Storage isolation regression" });
  await expect(restoredRow.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(
    restoredRow.getByRole("button", { name: "Review permissions" }),
  ).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-unapproved-plugin",
    "executed",
  );
  await expect(page.locator('iframe[title="Plugin runtime"]')).toHaveCount(0);
});
