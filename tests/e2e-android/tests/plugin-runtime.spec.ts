/**
 * Android 插件安装与可执行插件 E2E（ADR-056，Phase 5）。
 *
 * 本待办的核心问题是「Android WebView 能否**执行**可执行插件（Blob Worker +
 * Worker 内 blob entry 动态 import）」。生产 APK（`https://localhost`，构建期 CSP 已注入）
 * 下逐层验证：
 *
 * 1. **探针证据**：页面上下文直接跑一次「Blob Worker → Worker 内 import(blob entry)」；
 * 2. **安装入口**：`pluginInstall: "upload"` → Settings → Plugins 渲染隐藏文件输入（能力结构性证据）；
 * 3. **纯清单插件安装**：`setInputFiles(.json)` → 安全确认 → Installed → 存储落盘；
 * 4. **可执行插件安装**：`setInputFiles(.mjs)` → 安全确认（隔离执行）→ Installed → 存储带执行面；
 * 5. **执行面真机可用**：reload 后启动路径（`startPlugins` → Blob Worker 加载）仍成功 → 卸载回收；
 * 6. **同进程执行 + 同步贡献**：以 same-process 安装 → reload 后表列表出现插件分组 → 卸载回收；
 * 7. 全程无 console 错误。
 *
 * 两点真机约束（见 ADR-056 §已知限制）：
 * - **不点击 Install 按钮**：它会拉起设备侧系统文件选择器（原生 Activity），自动化无法驱动且会把
 *   WebView 切到后台（实测会令后续抽屉交互失败）；安装流程一律经 `setInputFiles` 直接投递文件
 *   （即隐藏 input + `file.text()` 的真实应用路径，仅跳过 OS 选择器 UI）。
 * - **移动布局（< 1024px）**：Settings 收在顶栏「More」下拉内，表列表在左侧抽屉内（ADR-050 Phase 3）。
 */
import { expect, test } from "@playwright/test";
import {
  dismissConnectionSettings,
  openAppSession,
  type AppSession,
} from "../helpers/app";
import { pluginArtifact, readPluginStore } from "../helpers/plugins";

/** 可执行插件（单文件 entry：codec + dataType 同步贡献）。 */
const CUSTOM_FC_PLUGIN = "custom-function-code";
/** 纯清单插件（无执行面，仅贡献主题色）。 */
const THEME_PLUGIN = "example-theme";

let session: AppSession;

test.beforeAll(async () => {
  session = await openAppSession();
  await dismissConnectionSettings(session.page);
});

test.afterAll(async () => {
  await session?.close();
});

/** 等待应用就绪（reload 之后；启动自动弹出的 Connection Settings 一并收掉）。 */
async function waitForAppReady(): Promise<void> {
  const page = session.page;
  await page.waitForSelector(".register-table-tabs", { timeout: 60_000 });
  await dismissConnectionSettings(page);
}

/** 打开顶栏 Settings（移动布局收进「More」下拉，与 `code-splitting.spec.ts` 同套路）。 */
async function openSettings(): Promise<void> {
  const page = session.page;
  if ((await page.locator(".settings-drawer.ant-drawer-open").count()) > 0) {
    return;
  }
  const topbar = page.locator(".mamep-header");
  const more = topbar.getByRole("button", { name: "More", exact: true });
  if ((await more.count()) > 0) {
    await more.click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  } else {
    await topbar
      .getByRole("button", { name: "Settings", exact: true })
      .click();
  }
  await page.waitForSelector(".settings-drawer.ant-drawer-open", {
    timeout: 10_000,
  });
}

/** 打开 Settings 抽屉的 Plugins 页签，返回插件管理区块。 */
async function openPluginsSection() {
  const page = session.page;
  await openSettings();
  await page
    .locator(".settings-drawer")
    .getByRole("tab", { name: "Plugins" })
    .click();
  const section = page.getByTestId("plugin-manager");
  await expect(section).toBeVisible();
  return section;
}

/** 关闭 Settings 抽屉：优先 Esc（不依赖命中测试），失败回退点关闭按钮。 */
async function closeSettings(): Promise<void> {
  const page = session.page;
  const wrapper = page.locator(".settings-drawer .ant-drawer-content-wrapper");
  if (await wrapper.isHidden()) return;
  try {
    await page.keyboard.press("Escape");
    await expect(wrapper).toBeHidden({ timeout: 8_000 });
  } catch {
    await page
      .locator(".settings-drawer .ant-drawer-close")
      .first()
      .evaluate((element) => (element as HTMLElement).click());
    await expect(wrapper).toBeHidden({ timeout: 8_000 });
  }
}

/** 打开表列表（移动布局下为左侧抽屉；分组只存在于抽屉内）。 */
async function openTableList(): Promise<void> {
  const page = session.page;
  const menuButton = page.locator(".mamep-header__menu");
  if ((await menuButton.count()) === 0) return;
  await menuButton.click();
  await page.waitForSelector(".mamep-mobile-drawer--sidebar", {
    timeout: 10_000,
  });
}

/** 关闭表列表抽屉（等离场动画结束，避免遮罩吞掉后续点击）。 */
async function closeTableList(): Promise<void> {
  const page = session.page;
  await page.keyboard.press("Escape");
  await expect(page.locator(".mamep-mobile-drawer--sidebar")).toBeHidden({
    timeout: 10_000,
  });
}

/** 表列表中的插件贡献分组（同步注册面生效的证据；文案取 i18n `plugins.customFunctionTitle`）。 */
function pluginContribution(page: AppSession["page"]) {
  return page
    .locator(".sheet-sidebar__group-title")
    .filter({ hasText: "Custom FC 65H/66H" });
}

/** 经隐藏文件输入投递插件文件（绕过系统文件选择器）并在安全确认框中确认。 */
async function installPluginByFile(options: {
  filePath: string;
  /** `.mjs` 可执行插件：是否在确认框中选择「同进程执行」。 */
  sameProcess?: boolean;
}): Promise<void> {
  const page = session.page;
  const input = page.locator('input[data-testid="plugin-manifest-file-input"]');
  await expect(input).toBeAttached();
  await input.setInputFiles(options.filePath);

  const confirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await expect(confirm).toBeVisible({ timeout: 15_000 });
  if (options.sameProcess === true) {
    await confirm.getByText("Same process", { exact: false }).click();
  }
  await confirm.getByRole("button", { name: "Install", exact: true }).click();
  await expect(
    page.getByText("Plugin installed.", { exact: true }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

/** 卸载列表中的指定插件（按钮与确认框均为 DOM 交互，不涉及系统 UI）。 */
async function uninstallPlugin(pluginName: string): Promise<void> {
  const page = session.page;
  const section = await openPluginsSection();
  const row = section
    .locator(".ant-listy-item")
    .filter({ hasText: pluginName })
    .first();
  await row.getByRole("button", { name: "Uninstall", exact: true }).click();
  const confirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Uninstall this plugin?" });
  await confirm
    .getByRole("button", { name: "Uninstall", exact: true })
    .click();
  await expect(
    page.getByText("Plugin uninstalled.", { exact: true }).first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(section.getByText(pluginName, { exact: true })).toHaveCount(0);
  await closeSettings();
}

/** 插件存储中的插件记录（按 id）。 */
async function storedPlugin(pluginId: string): Promise<
  | {
      enabled?: boolean;
      executionMode?: string;
      entrySource?: string;
    }
  | undefined
> {
  const stored = (await readPluginStore(session.page)) as {
    plugins?: Array<{ manifest?: { id?: string } }>;
  } | null;
  return stored?.plugins?.find(
    (plugin) => plugin.manifest?.id === pluginId,
  ) as
    | { enabled?: boolean; executionMode?: string; entrySource?: string }
    | undefined;
}

test("真机 WebView 支持 Blob Worker 与 Worker 内 blob entry 动态 import（探针证据）", async () => {
  const result = await session.page.evaluate(async () => {
    const entrySource =
      'export const manifest = { id: "e2e-probe" }; export function activate() {}';
    const bootstrap = `
      self.onmessage = async (event) => {
        if (!event.data || event.data.type !== "init") return;
        try {
          const url = URL.createObjectURL(
            new Blob([event.data.entrySource], { type: "text/javascript" }),
          );
          const mod = await import(url);
          self.postMessage({ ok: true, hasManifest: Boolean(mod && mod.manifest) });
        } catch (err) {
          self.postMessage({ ok: false, message: String(err) });
        }
      };
    `;
    return await new Promise<{
      ok: boolean;
      hasManifest?: boolean;
      message?: string;
    }>((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(
          URL.createObjectURL(
            new Blob([bootstrap], { type: "text/javascript" }),
          ),
        );
      } catch (err) {
        resolve({ ok: false, message: `worker-create: ${String(err)}` });
        return;
      }
      const timer = setTimeout(() => {
        worker.terminate();
        resolve({ ok: false, message: "timeout" });
      }, 8000);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(event.data as { ok: boolean });
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        worker.terminate();
        resolve({ ok: false, message: `worker-error: ${event.message}` });
      };
      worker.postMessage({ type: "init", entrySource });
    });
  });

  expect(result, `Blob Worker 探测失败：${result.message ?? ""}`).toEqual(
    expect.objectContaining({ ok: true, hasManifest: true }),
  );
});

test("安装入口可用（pluginInstall: upload）：隐藏文件输入与 Install 按钮就位", async () => {
  const page = session.page;
  const section = await openPluginsSection();

  // 隐藏文件输入**仅**在 `pluginInstall === "upload"` 时渲染 → 其存在即能力证据。
  const input = page.locator('input[data-testid="plugin-manifest-file-input"]');
  await expect(input).toBeAttached();
  await expect(input).toHaveAttribute("accept", ".json,.mjs,.js");
  await expect(
    section.getByRole("button", { name: "Install Plugin" }),
  ).toBeVisible();

  await closeSettings();
});

test("纯清单插件安装闭环（.json）：安全确认 → Installed → 存储落盘", async () => {
  const section = await openPluginsSection();

  await installPluginByFile({
    filePath: pluginArtifact(THEME_PLUGIN, "manifest.json"),
  });

  await expect(
    section.getByText("Example Theme", { exact: true }),
  ).toBeVisible();
  await expect(section.getByText("Installed", { exact: true })).toBeVisible();
  // 持久化：存储中出现该插件（纯清单 → 无 entrySource / executionMode）。
  const stored = await storedPlugin(THEME_PLUGIN);
  expect(stored).toBeDefined();
  expect(stored?.enabled).toBe(true);
  expect(stored?.entrySource).toBeUndefined();

  await closeSettings();
});

test("可执行插件安装闭环（.mjs，隔离执行）：安全确认 → Installed → 存储带执行面", async () => {
  const section = await openPluginsSection();

  await installPluginByFile({
    filePath: pluginArtifact(CUSTOM_FC_PLUGIN, `${CUSTOM_FC_PLUGIN}.mjs`),
  });

  await expect(
    section.getByText("Custom Function Code", { exact: true }),
  ).toBeVisible();
  // 持久化：entrySource + executionMode 落盘（重启后据此重建执行面）。
  const stored = await storedPlugin(CUSTOM_FC_PLUGIN);
  expect(stored?.executionMode).toBe("isolated");
  expect((stored?.entrySource ?? "").length).toBeGreaterThan(0);

  await closeSettings();
});

test("reload 后 isolated 可执行插件仍被真机加载（Blob Worker 路径），卸载后回收", async () => {
  const page = session.page;

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAppReady();

  // 列表仍显示（entry 加载失败会被跳过并记录错误，插件不会出现在列表里）。
  const section = await openPluginsSection();
  await expect(
    section.getByText("Custom Function Code", { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByText("Example Theme", { exact: true }),
  ).toBeVisible();
  await closeSettings();

  await uninstallPlugin("Custom Function Code");
  expect(await storedPlugin(CUSTOM_FC_PLUGIN)).toBeUndefined();
});

test("same-process 可执行插件贡献在真机生效（表列表出现插件分组），卸载后回收", async () => {
  const page = session.page;

  await openPluginsSection();
  await installPluginByFile({
    filePath: pluginArtifact(CUSTOM_FC_PLUGIN, `${CUSTOM_FC_PLUGIN}.mjs`),
    sameProcess: true,
  });
  expect((await storedPlugin(CUSTOM_FC_PLUGIN))?.executionMode).toBe(
    "same-process",
  );
  await closeSettings();

  // 重载后由存储重建同进程执行面 → 同步贡献（codec / tableType）注册 → 表列表出现分组。
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAppReady();
  await openTableList();
  await expect(pluginContribution(page)).toBeVisible({ timeout: 15_000 });
  await closeTableList();

  await uninstallPlugin("Custom Function Code");
  // 贡献回收：分组节点从 DOM 消失（表列表已渲染过，可直接断言）。
  await expect(pluginContribution(page)).toHaveCount(0);
  expect(await storedPlugin(CUSTOM_FC_PLUGIN)).toBeUndefined();
});

test("全程无 console 错误（能力探测 / 安装入口 / 插件执行）", () => {
  expect(session.consoleErrors).toEqual([]);
});
