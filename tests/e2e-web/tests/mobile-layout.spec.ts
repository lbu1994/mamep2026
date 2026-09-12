/**
 * 移动布局 E2E（ADR-050 Phase 3）。
 *
 * 浏览器端以 900×800 视口（< 1024 断点）验证移动布局：侧栏 → 左抽屉、底部面板 → 底部抽屉、
 * 移动端不渲染 Splitter 的侧栏/底部面板面板、表格横向滚动 + 固定前两列 + 行高 44。
 * 桌面（≥1024）行为由既有用例（1600×900 视口）守住，本文件不重复。
 */
import { expect, test, type Page } from "@playwright/test";
import { installExecutablePlugin } from "./helpers/manual-plugins";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

/** 移动布局视口（断点 1023px 之下）。 */
const MOBILE_VIEWPORT = { width: 900, height: 800 };

async function openMobileApp(page: Page): Promise<void> {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto(BASE_URL);
  await expect(
    page.locator(".connection-cluster__button[data-conn-state='connected']"),
  ).toBeVisible({ timeout: 15000 });
}

/**
 * 安装 Address Adjust 插件（ADR-054：地址变换由插件贡献，不再随包安装）。
 * 在**桌面视口**下安装（Settings 入口在窄视口下可能收进「更多」菜单）：
 * 先以默认视口进入应用 → 安装（同进程，同步能力必需）→ 再切到移动视口重载（已持久化）。
 */
async function installAddressAdjust(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await expect(
    page.locator(".connection-cluster__button[data-conn-state='connected']"),
  ).toBeVisible({ timeout: 15000 });
  await installExecutablePlugin(page, {
    pluginId: "builtin-address-adjust",
    pluginName: "Address Adjust",
    executionMode: "same-process",
  });
}

test("移动布局：侧栏收起为左抽屉，选中表后自动关闭", async ({ page }) => {
  await openMobileApp(page);

  // 常驻侧栏不渲染（移动端由抽屉承担），Splitter 的侧栏面板同样不在 DOM。
  await expect(page.locator(".sheet-sidebar")).toHaveCount(0);
  // 单子面板的 Splitter 不渲染拖拽条（antd useResizable 循环 i < len-1）。
  await expect(page.locator(".mamep-main .ant-splitter-bar")).toHaveCount(0);

  // 汉堡按钮打开表列表抽屉。
  // antd v6：`className` 落在 .ant-drawer-section（内容面板），开合状态类在 root .ant-drawer。
  await page.getByRole("button", { name: "Open table list" }).click();
  const sidebarDrawer = page.locator(
    ".ant-drawer:has(.mamep-mobile-drawer--sidebar)",
  );
  await expect(sidebarDrawer).toHaveClass(/ant-drawer-open/);
  await expect(
    sidebarDrawer.locator(".mamep-mobile-drawer--sidebar .sheet-sidebar--drawer"),
  ).toBeVisible();
  const sheetItems = sidebarDrawer.locator(".ant-menu-item");
  await expect(sheetItems.first()).toBeVisible();

  // 选中一张表 → 抽屉自动收起（移动端没有常驻侧栏，避免遮挡表格）。
  await sheetItems.first().click();
  await expect(sidebarDrawer).not.toHaveClass(/ant-drawer-open/, {
    timeout: 10000,
  });
  await expect(page.locator(".register-table-tabs")).toBeVisible();
});

test("移动布局：底部面板成为底部抽屉", async ({ page }) => {
  await openMobileApp(page);

  // 常驻底部面板不渲染。
  await expect(page.locator(".bottom-panel")).toHaveCount(0);

  await page.getByRole("button", { name: "Open panel" }).click();
  const panelDrawer = page.locator(".ant-drawer:has(.mamep-mobile-drawer--panel)");
  await expect(panelDrawer).toHaveClass(/ant-drawer-open/);
  // drawer 形态：不套折叠类，也不渲染折叠按钮（高度由抽屉控制）。
  await expect(panelDrawer.locator(".bottom-panel--drawer")).toBeVisible();
  await expect(panelDrawer.locator(".ant-tabs-tab").first()).toBeVisible();
});

test("移动表格：横向滚动 + 无固定列 + 行高 44", async ({ page }) => {
  await openMobileApp(page);

  const sheet = page.locator(".register-table-tabs .ant-tabs-content-active");
  await expect(sheet.locator(".ant-table-tbody")).toBeVisible();

  // 横向可滚动（scroll.x=960 > 900 视口）。带 scroll.y 时 antd 用 .ant-table-body
  // 作为滚动容器（无 scroll.y 才是 .ant-table-content），故两者都匹配。
  const scroller = sheet.locator(".ant-table-content, .ant-table-body").first();
  const scrollable = await scroller.evaluate(
    (element) => element.scrollWidth > element.clientWidth,
  );
  expect(scrollable).toBe(true);

  // 窄屏**不做任何列固定**（2026-09-11 用户决策）：固定列在多列横滑时占用可视宽度且
  // 与触摸横滑手势争抢，故与桌面一致都不固定。
  // antd v6 固定列会带 `ant-table-cell-fix*` 类（v5 的 -fix-left 在 v6 已不存在）。
  await expect(sheet.locator('[class*="ant-table-cell-fix"]')).toHaveCount(0);

  // 移动端行高 44px（触摸目标；桌面为 29px）。
  const firstCell = sheet.locator(".ant-table-tbody > tr.ant-table-row > td").first();
  await expect(firstCell).toHaveCSS("height", "44px");
});

test("移动工具栏：次要控件收进「更多」面板，主操作仍在工具栏", async ({
  page,
}) => {
  // Address Adjust 现为插件贡献（ADR-054）：先安装（同进程）再切移动视口。
  await installAddressAdjust(page);
  await openMobileApp(page);

  const toolbar = page.locator(".table-toolbar");
  // 主操作保持直接可达（一步到位，不进面板）。
  await expect(toolbar.getByRole("button", { name: "Add Row" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Read All" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Undo" })).toBeVisible();
  // 次要控件不在工具栏内（未展开时）。
  await expect(toolbar.locator(".table-toolbar__radix")).toHaveCount(0);

  await toolbar
    .getByRole("button", { name: "More toolbar actions" })
    .click();
  const panel = page.locator(".table-toolbar__more");
  await expect(panel).toBeVisible();
  // 同一份控件在面板内可用：地址进制 / 从站地址 / 写后回读 / 地址变换 / 恢复列布局。
  await expect(panel.locator(".table-toolbar__radix")).toBeVisible();
  await expect(panel.locator(".table-toolbar__slave")).toBeVisible();
  await expect(panel.locator(".table-toolbar__verify")).toBeVisible();
  await expect(panel.locator(".table-toolbar__adjust")).toBeVisible();

  // 面板内交互生效（地址进制切到 HEX）：antd Segmented 的可点元素是 .ant-segmented-item
  // （内部隐藏 input 不可点/不可见，getByRole("radio") 会解析到它而超时）。
  const radix = panel.locator(".table-toolbar__radix");
  await radix.locator(".ant-segmented-item", { hasText: "HEX" }).click();
  await expect(radix.locator(".ant-segmented-item-selected")).toHaveText("HEX");
});

test("移动布局无 console 错误", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await openMobileApp(page);
  await page.getByRole("button", { name: "Open table list" }).click();
  await expect(
    page.locator(".ant-drawer:has(.mamep-mobile-drawer--sidebar)"),
  ).toHaveClass(/ant-drawer-open/);
  await page.keyboard.press("Escape");
  await expect(
    page.locator(".ant-drawer:has(.mamep-mobile-drawer--sidebar)"),
  ).not.toHaveClass(/ant-drawer-open/);
  await page.getByRole("button", { name: "Open panel" }).click();
  await expect(
    page.locator(".ant-drawer:has(.mamep-mobile-drawer--panel)"),
  ).toHaveClass(/ant-drawer-open/);
  await page.keyboard.press("Escape");
  // 工具栏「更多」面板也纳入无 console 错误检查（Popover + 控件重排）。
  await page
    .locator(".table-toolbar")
    .getByRole("button", { name: "More toolbar actions" })
    .click();
  await expect(page.locator(".table-toolbar__more")).toBeVisible();

  expect(errors).toEqual([]);
});
