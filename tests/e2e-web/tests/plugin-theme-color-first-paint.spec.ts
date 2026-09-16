/**
 * 插件主题色「首帧即已应用」e2e（mockTransport=1，浏览器端，2026-09-16）。
 *
 * **Bug**：用户选择**插件提供的主题色**（ADR-047，如 example-theme 的 Indigo）后刷新页面，
 * 首屏会先按 **Ant Design 默认蓝**渲染，等插件从存储恢复（`host.startPlugins()` fire-and-forget：
 * 读插件存储 → 逐个 register → activate → 贡献点写入）后才变成插件色 —— 品牌色（主按钮 /
 * 表头选中态 / 表格选行 / 骨架屏 Spin）先蓝后变。
 *
 * **复现（红）**：安装 example-theme → Settings 选 Indigo → 等自动保存 → 注册记录器 → reload；
 * 记录器在「`#root` 首次出现子节点」（= 首帧渲染提交）时读取 `.ant-app` 上的
 * `--ant-color-primary`（antd cssVar 运行时值）。修复前该值是默认蓝（非 `#4f46e5`）→ 断言失败。
 *
 * **修复（绿）**：启动缓存额外记住「上次解析出的主色种子」，并在「选了预设但插件贡献尚未就绪」
 * 期间用它（插件就绪后仍以注册表为准，见 `resolveThemeColorSeed`）。
 *
 * 全程无 console 错误。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";
/** 插件提供的靛蓝主题色（plugins/example-theme，与 theme-color-presets.spec.ts 同源）。 */
const INDIGO = "#4f46e5";
/** example-theme 手动安装清单（自 tests/e2e-web/tests/ 上跳三级到仓库根）。 */
const EXAMPLE_THEME_MANIFEST = path.resolve(
  import.meta.dirname,
  "../../../plugins/example-theme/manifest.json",
);

/** 首帧记录（记录器写入 `window.__mamepThemeBoot`）。 */
interface ThemeBootRecord {
  marked: boolean;
  primaryAtFirstRender: string | null;
  appAtFirstRender: boolean;
}

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  return errors;
}

async function openSettings(page: Page): Promise<void> {
  if ((await page.locator(".settings-drawer.ant-drawer-open").count()) === 0) {
    await page
      .getByRole("button", { name: "Settings" })
      .evaluate((el) => (el as HTMLElement).click());
    await page.waitForSelector(".settings-drawer.ant-drawer-open", {
      timeout: 5000,
    });
  }
  await page
    .locator(".settings-drawer")
    .getByRole("tab", { name: "General" })
    .click();
}

async function closeSettings(page: Page): Promise<void> {
  await page.locator(".settings-drawer .ant-drawer-close").first().click();
  await expect(
    page.locator(".settings-drawer .ant-drawer-content-wrapper"),
  ).toBeHidden();
}

/** 经 Settings → Plugins 手动安装 example-theme（该示例不随包，需手动安装）。 */
async function installExampleTheme(page: Page): Promise<void> {
  await openSettings(page);
  await page
    .locator(".settings-drawer")
    .getByRole("tab", { name: "Plugins" })
    .click();
  const section = page.getByTestId("plugin-manager");
  await expect(section).toBeVisible();
  await section.getByRole("button", { name: "Install Plugin" }).click();
  const input = page.locator('input[data-testid="plugin-manifest-file-input"]');
  await expect(input).toBeAttached();
  await input.setInputFiles({
    name: "manifest.json",
    mimeType: "application/json",
    buffer: Buffer.from(readFileSync(EXAMPLE_THEME_MANIFEST, "utf8"), "utf8"),
  });
  const confirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Install", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(section).toContainText("Example Theme");
  await closeSettings(page);
}

/** 在 Settings 的主题色下拉中按名称选择选项。 */
async function selectThemeColor(page: Page, name: string): Promise<void> {
  await page.getByLabel("Accent color").click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: name })
    .first()
    .click();
}

/** 读取 `.ant-app` 上的 antd cssVar 主色（运行时值，不写死）。 */
async function antdPrimary(page: Page): Promise<string> {
  const value = await page.evaluate(() => {
    const el = document.querySelector(".ant-app");
    return el === null
      ? ""
      : getComputedStyle(el).getPropertyValue("--ant-color-primary");
  });
  return value.trim();
}

/**
 * 注册首帧主色记录器（`addInitScript`，本次及后续导航的文档创建时执行）：
 * `#root` 首次出现子节点那一刻读取 `.ant-app` 的 `--ant-color-primary`。
 */
async function installThemeBootRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const record: ThemeBootRecord = {
      marked: false,
      primaryAtFirstRender: null,
      appAtFirstRender: false,
    };
    (window as unknown as { __mamepThemeBoot: ThemeBootRecord }).__mamepThemeBoot =
      record;

    const readPrimary = (): { primary: string; hasApp: boolean } => {
      const el = document.querySelector(".ant-app");
      if (el === null) return { primary: "", hasApp: false };
      return {
        primary: getComputedStyle(el).getPropertyValue("--ant-color-primary").trim(),
        hasApp: true,
      };
    };
    const watchRoot = (): void => {
      const root = document.getElementById("root");
      if (root === null) return;
      const mark = (): void => {
        if (record.marked || root.childElementCount === 0) return;
        record.marked = true;
        const read = readPrimary();
        record.primaryAtFirstRender = read.primary;
        record.appAtFirstRender = read.hasApp;
      };
      mark();
      new MutationObserver(mark).observe(root, { childList: true });
    };
    watchRoot();
    new MutationObserver(watchRoot).observe(document, {
      childList: true,
      subtree: true,
    });
  });
}

function readThemeBootRecord(page: Page): Promise<ThemeBootRecord> {
  return page.evaluate(
    () => (window as unknown as { __mamepThemeBoot: ThemeBootRecord }).__mamepThemeBoot,
  );
}

test("插件主题色：刷新后首帧即已应用（不等插件恢复）", async ({ page }) => {
  const errors = await openApp(page);
  await installExampleTheme(page);
  await openSettings(page);
  await selectThemeColor(page, "Indigo");
  await expect.poll(() => antdPrimary(page)).toContain(INDIGO);
  await closeSettings(page);
  // 等自动保存（IndexedDB 防抖 500ms）落盘，再刷新。
  await page.waitForTimeout(1000);

  await installThemeBootRecorder(page);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });

  const record = await readThemeBootRecord(page);
  // 记录器自检：首帧应已存在 .ant-app（否则读数无意义）。
  expect(record.appAtFirstRender).toBe(true);
  // 关键断言（修复红 / 绿分界）：首帧主色已是插件色，而非 Ant Design 默认蓝。
  expect(String(record.primaryAtFirstRender).toLowerCase()).toContain(INDIGO);
  // 就绪后仍是插件色（无回归）。
  await expect.poll(() => antdPrimary(page)).toContain(INDIGO);

  expect(errors).toEqual([]);
});
