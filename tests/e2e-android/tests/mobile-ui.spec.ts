/**
 * Android 移动布局 + 硬件返回键 e2e（ADR-050 Phase 3）——**需要真机，不需要串口硬件**。
 *
 * 覆盖手机竖屏（< 1024px 断点）下的可观察结果：
 * - 常驻侧栏 / 底部面板不再渲染，改为由顶栏按钮打开的抽屉；
 * - 工具栏次要控件（进制 / 从站地址 / 写后回读 / Address Adjust / 恢复列布局）收进「更多」面板，
 *   主操作（撤销/重做、新建行、Read All）仍在工具栏；
 * - 硬件返回键（`@capacitor/app`）：有覆盖层时关抽屉且不离开应用，无覆盖层时最小化到后台。
 *
 * **为何不用 `document.visibilityState` 判定后台**（2026-09-13 真机实测）：Playwright 经 CDP
 *（DevTools）附着页面时，Chromium 会把页面**强制视为 visible**，故最小化后 `visibilityState`
 * 仍为 `visible`（应用实际已退到 launcher）。改用**系统层面前台窗口**判定。
 *
 * 真机 e2e 为独立命令 `pnpm test:e2e:android`（不进 `test:all`），需 USB 调试 + 解锁屏幕。
 *
 * 约束：**本文件的用例必须放在「硬件返回键」用例之前**。该用例会把应用退到后台且不再唤回
 *（该 vivo ROM 上应用退后台后 `am start` 会回「intent has been delivered to currently running
 * top-most instance」而不重排任务、前台焦点不回归；属环境行为，非产品缺陷，故不做唤回脚手架），
 * 而每个 spec 的 `beforeAll` 会重装/清数据/重启应用、`afterAll` 会 force-stop，故不影响其他 spec。
 */
import { expect, test } from "@playwright/test";
import { APP_ID, adb, ensureScreenAwake } from "../helpers/adb";
import {
  dismissConnectionSettings,
  openAppSession,
  type AppSession,
} from "../helpers/app";

let session: AppSession;

test.beforeAll(async () => {
  session = await openAppSession();
});

test.afterAll(async () => {
  await session?.close();
});

/** 按一次硬件返回键（Android 系统级，不走 DOM 事件）。 */
function pressBack(): void {
  adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
}

/**
 * 当前系统前台窗口（`mCurrentFocus` 的实际值；同一输出里可能有一行为 null，故取最后一个非 null）。
 * 用于判定「返回键是否把应用退到后台」——比 `document.visibilityState` 可靠（CDP 会把页面强制视为 visible）。
 */
function foregroundWindow(): string {
  const lines = adb(["shell", "dumpsys", "window"]).split(/\r?\n/);
  const focuses = lines
    .filter((line) => line.includes("mCurrentFocus"))
    .map((line) => line.trim())
    .filter((line) => !line.endsWith("null"));
  return focuses.at(-1) ?? "";
}

test("移动布局：侧栏/底部面板改为抽屉，工具栏次要控件进「更多」面板", async () => {
  const { page } = session;
  await dismissConnectionSettings(page);

  // 移动布局：常驻侧栏不渲染（改由汉堡按钮打开左抽屉）。
  await expect(page.locator(".sheet-sidebar")).toHaveCount(0);
  await expect(page.locator(".bottom-panel")).toHaveCount(0);

  await page.getByRole("button", { name: "Open table list" }).click();
  const sidebarDrawer = page.locator(
    ".ant-drawer:has(.mamep-mobile-drawer--sidebar)",
  );
  await expect(sidebarDrawer).toHaveClass(/ant-drawer-open/);
  await expect(sidebarDrawer.locator(".sheet-sidebar--drawer")).toBeVisible();

  // 选中表 → 抽屉自动收起（移动端没有常驻侧栏，避免遮挡表格）。
  await sidebarDrawer.locator(".ant-menu-item").first().click();
  await expect(sidebarDrawer).not.toHaveClass(/ant-drawer-open/, {
    timeout: 10_000,
  });

  // 工具栏：主操作直接可达，次要控件收进「更多」。
  const toolbar = page.locator(".table-toolbar");
  await expect(toolbar.getByRole("button", { name: "Read All" })).toBeVisible();
  await expect(toolbar.locator(".table-toolbar__radix")).toHaveCount(0);

  await toolbar
    .getByRole("button", { name: "More toolbar actions" })
    .click();
  const panel = page.locator(".table-toolbar__more");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".table-toolbar__radix")).toBeVisible();
  await expect(panel.locator(".table-toolbar__slave")).toBeVisible();
  await expect(panel.locator(".table-toolbar__verify")).toBeVisible();

  // 移动表格：横向可滚动 + 行高 44（触摸目标）。
  const sheet = page.locator(".register-table-tabs .ant-tabs-content-active");
  const scroller = sheet.locator(".ant-table-content, .ant-table-body").first();
  expect(
    await scroller.evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  await expect(
    sheet.locator(".ant-table-tbody > tr.ant-table-row > td").first(),
  ).toHaveCSS("height", "44px");

  expect(session.consoleErrors).toEqual([]);
});

test("硬件返回键：先关抽屉（不离开应用），无覆盖层时才最小化到后台", async () => {
  const { page } = session;

  // 息屏会让焦点落在 keyguard、使前台断言失真，故交互前先唤醒。
  ensureScreenAwake();

  // 打开抽屉 → 返回键应只关抽屉，应用仍在前台。
  await page.getByRole("button", { name: "Open table list" }).click();
  const sidebarDrawer = page.locator(
    ".ant-drawer:has(.mamep-mobile-drawer--sidebar)",
  );
  await expect(sidebarDrawer).toHaveClass(/ant-drawer-open/);

  pressBack();
  await expect(sidebarDrawer).not.toHaveClass(/ant-drawer-open/, {
    timeout: 15_000,
  });
  // 「不离开应用」：返回键只关抽屉，前台窗口仍是本应用。
  await expect
    .poll(() => foregroundWindow(), { timeout: 15_000 })
    .toContain(APP_ID);

  // 无覆盖层 → 返回键最小化应用（Android 惯例：退到后台，不退出进程）。
  pressBack();
  await expect
    .poll(() => foregroundWindow(), { timeout: 20_000 })
    .not.toContain(APP_ID);

  expect(session.consoleErrors).toEqual([]);
});
