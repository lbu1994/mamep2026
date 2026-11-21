/**
 * Settings 抽屉 e2e（mockTransport=1，浏览器端）。
 *
 * 覆盖：
 * - 容器类型：Settings 打开后是右侧 `Drawer`（`.settings-drawer.ant-drawer-open`），
 *   且**不再是 Modal**（`.ant-modal-container:visible` 计数为 0）；
 * - 打开入口：`Ctrl+,` 快捷键与顶栏 `Settings` 按钮；
 * - 关闭方式：`Esc`、点击遮罩（抽屉外）；
 * - 宽度策略：数值 `size={420}`（antd v6 的 width/height 已弃用，故不写死字符串宽度）；
 * - 全程无 console 错误（守门弃用属性 / 非法 size 类型类回归）。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";
const EXPECTED_DRAWER_WIDTH = 420;

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  return errors;
}

function settingsDrawer(page: Page) {
  return page.locator(".settings-drawer");
}

/** 等待 Settings 抽屉完成打开。 */
async function waitForDrawerOpen(page: Page): Promise<void> {
  await page.waitForSelector(".settings-drawer.ant-drawer-open", {
    timeout: 5000,
  });
}

/** 断言抽屉已关闭（开合类移除 + 离场动画跑完，内容 wrapper 置 display:none）。 */
async function expectDrawerClosed(page: Page): Promise<void> {
  await expect(page.locator(".settings-drawer.ant-drawer-open")).toHaveCount(0);
  await expect(
    page.locator(".settings-drawer .ant-drawer-content-wrapper"),
  ).toBeHidden();
}

test("Ctrl+, 打开的是 Settings 抽屉而非 Modal，Esc 可关闭", async ({
  page,
}) => {
  const errors = await openApp(page);

  await page.keyboard.press("Control+,");
  await waitForDrawerOpen(page);

  const drawer = settingsDrawer(page);
  await expect(drawer).toHaveClass(/ant-drawer/);
  // 标题与内容（原 Modal 内的设置项原样保留）。
  await expect(drawer.locator(".ant-drawer-header")).toContainText("Settings");
  // 插件管理并入：抽屉内含 General / Plugins 两个页签，默认停在 General。
  await expect(drawer.getByRole("tab", { name: "General" })).toBeVisible();
  await expect(drawer.getByRole("tab", { name: "Plugins" })).toBeVisible();
  await expect(drawer.getByLabel("Accent color")).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "Reset Workspace" }),
  ).toBeVisible();
  await expect(
    drawer.getByRole("button", { name: "Export Workspace" }),
  ).toBeVisible();
  // 不再是 Modal。
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);
  // 宽度沿用数值 size={420}（窄屏由 CSS max-width 兜底）。
  const wrapper = page.locator(".settings-drawer .ant-drawer-content-wrapper");
  const box = await wrapper.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box?.width ?? 0)).toBe(EXPECTED_DRAWER_WIDTH);

  // Esc 关闭（Drawer 默认行为，与改造前 Modal 的键盘交互一致）。
  await page.keyboard.press("Escape");
  await expectDrawerClosed(page);

  expect(errors).toEqual([]);
});

test("顶栏 Settings 按钮打开抽屉，点击遮罩关闭", async ({ page }) => {
  const errors = await openApp(page);

  await page
    .getByRole("button", { name: "Settings", exact: true })
    .evaluate((el) => (el as HTMLElement).click());
  await waitForDrawerOpen(page);
  await expect(
    settingsDrawer(page).getByRole("button", { name: "Reset Workspace" }),
  ).toBeVisible();

  // 点击遮罩（视口左上角，落点在抽屉之外）→ 关闭。
  await page
    .locator(".settings-drawer .ant-drawer-mask")
    .click({ position: { x: 10, y: 10 } });
  await expectDrawerClosed(page);

  expect(errors).toEqual([]);
});
