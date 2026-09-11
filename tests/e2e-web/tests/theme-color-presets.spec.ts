/**
 * 主题色预设选择器 e2e（mockTransport=1，浏览器端，2026-09-02，ADR-047；ADR-048 去字面量；
 * 2026-09-03：主题色示例已剥离为独立插件 `plugins/example-theme`，不随包，需手动安装）。
 * 验证：
 * - 内置仅一个选项：Ant Design 默认蓝（其值由 antd 运行时令牌决定，ADR-048：不写死色值）；
 *   --mamep-brand-primary 与页面 --ant-color-primary 同步（浅/深）；
 * - 默认（未安装 example-theme）仅默认蓝；经 Settings → Plugins 手动安装后可选主题色出现且**不自动应用**；
 * - 选中插件色 → antd token / --mamep-brand-primary 同步 + reload 持久化；
 * - 禁用插件后选项消失、已选色回退默认；
 * - 全程无 console 错误。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";
const INDIGO = "#4f46e5";
/** example-theme 手动安装清单工件路径（自 tests/e2e-web/tests/ 上跳三级到仓库根）。 */
const EXAMPLE_THEME_MANIFEST = path.resolve(
  import.meta.dirname,
  "../../../plugins/example-theme/manifest.json",
);

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

/** 切到 Settings 抽屉的指定页签（2026-09-12：抽屉内含 General / Plugins 页签）。 */
async function clickSettingsTab(page: Page, name: string): Promise<void> {
  await page.locator(".settings-drawer").getByRole("tab", { name }).click();
}

/** 打开 Settings 抽屉并停在 General 页签（已打开时幂等）。
 * 2026-09-12：容器由 Modal 改为 Drawer（类名 .settings-drawer）；插件管理并入后页签会保留上次选择，
 * 故助手显式回到 General，供主题/语言类断言使用。 */
async function openSettings(page: Page): Promise<void> {
  if ((await page.locator(".settings-drawer.ant-drawer-open").count()) === 0) {
    await page
      .getByRole("button", { name: "Settings" })
      .evaluate((el) => (el as HTMLElement).click());
    await page.waitForSelector(".settings-drawer.ant-drawer-open", {
      timeout: 5000,
    });
  }
  await clickSettingsTab(page, "General");
}

/** 关闭 Settings 抽屉（等离场动画结束；插件管理已并入，不再有独立弹窗）。 */
async function closeSettings(page: Page): Promise<void> {
  await page.locator(".settings-drawer .ant-drawer-close").first().click();
  await expect(
    page.locator(".settings-drawer .ant-drawer-content-wrapper"),
  ).toBeHidden();
  await expect(page.locator(".settings-drawer.ant-drawer-open")).toHaveCount(0);
}

/** 打开 Settings 抽屉的 Plugins 页签，返回插件管理区块定位器（已打开时幂等）。 */
async function openPluginManager(page: Page) {
  if ((await page.locator(".settings-drawer.ant-drawer-open").count()) === 0) {
    await page
      .getByRole("button", { name: "Settings" })
      .evaluate((el) => (el as HTMLElement).click());
    await page.waitForSelector(".settings-drawer.ant-drawer-open", {
      timeout: 5000,
    });
  }
  await clickSettingsTab(page, "Plugins");
  const section = page.getByTestId("plugin-manager");
  await expect(section).toBeVisible();
  return section;
}

/** 经 Settings → Plugins 手动安装 example-theme（浏览器 pluginInstall==="upload" 路径，
 * 选 plugins/example-theme/manifest.json）。2026-09-03：该示例不随包，需手动安装。 */
async function installExampleTheme(page: Page): Promise<void> {
  const section = await openPluginManager(page);
  await section.getByRole("button", { name: "Install Plugin" }).click();
  const input = page.locator('input[data-testid="plugin-manifest-file-input"]');
  await expect(input).toBeAttached();
  const content = readFileSync(EXAMPLE_THEME_MANIFEST, "utf8");
  await input.setInputFiles({
    name: "manifest.json",
    mimeType: "application/json",
    buffer: Buffer.from(content, "utf8"),
  });
  // §6.10.4 安全确认弹窗 → 确认安装。
  const confirm = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Install this plugin?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Install", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(section).toContainText("Example Theme");
  // 关闭 Settings 抽屉（后续断言/用例经 openSettings 重新打开）。
  await closeSettings(page);
}

/** 读取 .ant-app 上的 --mamep-brand-primary（.ant-app 作用域映射 var(--ant-color-primary)，ADR-048）。 */
async function brandPrimary(page: Page): Promise<string> {
  const value = await page.evaluate(() => {
    const el = document.querySelector(".ant-app");
    return el === null
      ? ""
      : getComputedStyle(el).getPropertyValue("--mamep-brand-primary");
  });
  return value.trim();
}

/** 读取 .ant-app 上的 --ant-color-primary（antd cssVar 运行时值，本 spec 不写死具体色值）。 */
async function antdPrimary(page: Page): Promise<string> {
  const value = await page.evaluate(() => {
    const el = document.querySelector(".ant-app");
    return el === null
      ? ""
      : getComputedStyle(el).getPropertyValue("--ant-color-primary");
  });
  return value.trim();
}

/** 按当前 antd 令牌的 hex 值换算 expected computed rgb（不依赖字面量）。 */
function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (m === null) throw new Error(`invalid hex: ${hex}`);
  const raw = m[1];
  if (raw === undefined) throw new Error(`invalid hex: ${hex}`);
  const n = parseInt(raw, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** 主色按钮的 computed background-color（Read All 为 antd primary）。 */
async function primaryButtonColor(page: Page): Promise<string> {
  const color = await page
    .locator(".table-toolbar .ant-btn-primary")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  return color;
}

/** 主题色 Select（aria-label = "Accent color"）。 */
function themeColorSelect(page: Page) {
  return page.getByLabel("Accent color");
}

/** 在主题色下拉中按名称选择选项。 */
async function selectThemeColor(page: Page, name: string): Promise<void> {
  await themeColorSelect(page).click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: name })
    .first()
    .click();
}

test("默认仅内置 Ant Design 默认蓝；插件色不自动应用（ADR-047 / ADR-048）", async ({
  page,
}) => {
  const errors = await openApp(page);

  // 默认主题色 = 运行时 antd 默认令牌。
  const antdBlue = await antdPrimary(page);
  await expect.poll(() => brandPrimary(page)).toBe(antdBlue);
  await expect.poll(() => primaryButtonColor(page)).toBe(hexToRgb(antdBlue));

  // 安装前：Settings 选择器仅内置默认蓝（example-theme 未安装）。
  await openSettings(page);
  await themeColorSelect(page).click();
  const optionsBefore = page.locator(
    ".ant-select-dropdown:visible .ant-select-item-option",
  );
  await expect(optionsBefore.filter({ hasText: "Default blue" })).toHaveCount(
    1,
  );
  await expect(optionsBefore.filter({ hasText: "Indigo" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await closeSettings(page);

  // 手动安装 example-theme 后：可选主题色出现，但仍不自动应用。
  await installExampleTheme(page);
  await openSettings(page);
  await themeColorSelect(page).click();
  const optionsAfter = page.locator(
    ".ant-select-dropdown:visible .ant-select-item-option",
  );
  await expect(optionsAfter.filter({ hasText: "Default blue" })).toHaveCount(1);
  await expect(optionsAfter.filter({ hasText: "Indigo" })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await closeSettings(page);

  await expect.poll(() => primaryButtonColor(page)).toBe(hexToRgb(antdBlue));

  expect(errors).toEqual([]);
});

test("默认蓝跟随 antd 令牌：--mamep-brand-primary 与 --ant-color-primary 浅/深同步（ADR-048，无字面量）", async ({
  page,
}) => {
  const errors = await openApp(page);

  // 浅色：mamep 令牌 === antd 令牌（运行时值）。
  const lightAntd = await antdPrimary(page);
  await expect.poll(() => brandPrimary(page)).toBe(lightAntd);

  // 切深色：antd 令牌更新，mamep 令牌同步跟随。
  await openSettings(page);
  await page
    .locator(".settings-drawer .ant-segmented-item-label")
    .filter({ hasText: "Dark" })
    .first()
    .click();
  await expect
    .poll(async () => {
      const value = await antdPrimary(page);
      return value;
    })
    .not.toBe(lightAntd);
  const darkAntd = await antdPrimary(page);
  await expect.poll(() => brandPrimary(page)).toBe(darkAntd);
  await closeSettings(page);

  expect(errors).toEqual([]);
});

test("选中插件色：antd token 与 CSS 变量同步 + reload 持久化", async ({
  page,
}) => {
  const errors = await openApp(page);
  // 手动安装 example-theme（不随包）后再选用靛蓝。
  await installExampleTheme(page);
  await openSettings(page);
  await selectThemeColor(page, "Indigo");

  // token / CSS 变量同步到插件色（#4f46e5）。
  await expect
    .poll(async () => {
      const value = await page.evaluate(() => {
        const el = document.querySelector(".ant-layout-header");
        return el === null
          ? ""
          : getComputedStyle(el).getPropertyValue("--ant-color-primary");
      });
      return value.trim();
    })
    .toContain(INDIGO);
  await expect.poll(() => brandPrimary(page)).toBe(INDIGO);
  await expect.poll(() => primaryButtonColor(page)).toBe("rgb(79, 70, 229)");

  // 持久化：关闭弹窗 → 刷新 → 仍是靛蓝。
  await closeSettings(page);
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  await openSettings(page);
  await themeColorSelect(page).click();
  const options = page.locator(
    ".ant-select-dropdown:visible .ant-select-item-option",
  );
  await expect(options.filter({ hasText: "Indigo" })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await closeSettings(page);
  await expect.poll(() => brandPrimary(page)).toBe(INDIGO);

  expect(errors).toEqual([]);
});

test("选中插件色后切深色：主色由 antd 算法派生，CSS 变量与 antd 实际渲染一致", async ({
  page,
}) => {
  const errors = await openApp(page);
  await installExampleTheme(page);
  await openSettings(page);
  await selectThemeColor(page, "Indigo");
  // 切深色（Settings 内 Light/Dark Segmented）。
  await page
    .locator(".settings-drawer .ant-segmented-item-label")
    .filter({ hasText: "Dark" })
    .first()
    .click();
  // 深色下 antd 派生主色 ≠ 浅色种子（#4f46e5 → 派生如 #463fc6 等）；等令牌更新。
  let darkAntd = "";
  await expect
    .poll(async () => {
      darkAntd = await antdPrimary(page);
      return darkAntd;
    })
    .not.toBe(INDIGO);
  // --mamep-brand-primary（.ant-app 映射 var(--ant-color-primary)）与 antd 实际渲染一致。
  await expect.poll(() => brandPrimary(page)).toBe(darkAntd);
  // 主按钮背景 = 派生后的暗色主色。
  await expect.poll(() => primaryButtonColor(page)).toBe(hexToRgb(darkAntd));
  await closeSettings(page);
  expect(errors).toEqual([]);
});

test("禁用插件后选项消失、已选色回退默认（ADR-047）", async ({ page }) => {
  const errors = await openApp(page);
  // 手动安装 example-theme 后选中靛蓝。
  await installExampleTheme(page);
  await openSettings(page);
  await selectThemeColor(page, "Indigo");
  await closeSettings(page);

  // 禁用 example-theme（按插件行定位，而非第一个 = example-panel）。
  const section = await openPluginManager(page);
  const row = section
    .locator(".ant-listy-item")
    .filter({ hasText: "Example Theme" });
  const switchEl = row.locator(".ant-switch");
  await switchEl.click();
  await expect(switchEl).not.toHaveClass(/ant-switch-checked/);
  // 切回 General 页签并关闭抽屉。
  await clickSettingsTab(page, "General");
  await closeSettings(page);

  // 回退默认蓝（运行时 antd 令牌）；选择器仅剩内置默认蓝选项。
  const antdBlue = await antdPrimary(page);
  await expect.poll(() => brandPrimary(page)).toBe(antdBlue);
  await expect.poll(() => primaryButtonColor(page)).toBe(hexToRgb(antdBlue));
  await openSettings(page);
  await themeColorSelect(page).click();
  const options = page.locator(
    ".ant-select-dropdown:visible .ant-select-item-option",
  );
  await expect(options.filter({ hasText: "Default blue" })).toHaveCount(1);
  await expect(options.filter({ hasText: "Indigo" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await closeSettings(page);

  expect(errors).toEqual([]);
});
