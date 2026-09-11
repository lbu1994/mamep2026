/**
 * Android 移动布局 + 硬件返回键 e2e（ADR-050 Phase 3）——**需要真机，不需要串口硬件**。
 *
 * 覆盖手机竖屏（< 1024px 断点）下的可观察结果：
 * - 常驻侧栏 / 底部面板不再渲染，改为由顶栏按钮打开的抽屉；
 * - 工具栏次要控件（进制 / 从站地址 / 写后回读 / Address Adjust / 恢复列布局）收进「更多」面板，
 *   主操作（撤销/重做、新建行、Read All）仍在工具栏；
 * - 硬件返回键（`@capacitor/app`）：有覆盖层时关抽屉且不离开应用，无覆盖层时最小化到后台。
 *
 * 真机 e2e 为独立命令 `pnpm test:e2e:android`（不进 `test:all`），需 USB 调试 + 解锁屏幕。
 */
import { expect, test } from "@playwright/test";
import { adb } from "../helpers/adb";
import { openAppSession, type AppSession } from "../helpers/app";

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

/** 把应用重新拉回前台（返回键最小化用例之后调用，保持后续用例可交互）。 */
function bringToForeground(): void {
  adb([
    "shell",
    "monkey",
    "-p",
    "com.mamep2026.app",
    "-c",
    "android.intent.category.LAUNCHER",
    "1",
  ]);
}

/** 关掉启动时自动弹出的 Connection Settings（工作区仍可查看，只是不连接）。 */
async function dismissConnectionSettings(page: AppSession["page"]): Promise<void> {
  const modal = page.locator(".ant-modal-container:visible");
  if ((await modal.count()) === 0) return;
  await modal
    .getByRole("button", { name: "Cancel", exact: true })
    .first()
    .click();
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);
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
  expect(await page.evaluate(() => document.visibilityState)).toBe("visible");

  // 无覆盖层 → 返回键最小化应用（Android 惯例：退到后台，不退出进程）。
  pressBack();
  await expect
    .poll(async () => page.evaluate(() => document.visibilityState), {
      timeout: 15_000,
    })
    .toBe("hidden");

  // 回前台，避免影响后续用例（e2e 运行顺序无关性）。
  bringToForeground();
  await expect
    .poll(async () => page.evaluate(() => document.visibilityState), {
      timeout: 20_000,
    })
    .toBe("visible");
  await expect(page.locator(".mamep-header")).toBeVisible();

  expect(session.consoleErrors).toEqual([]);
});
