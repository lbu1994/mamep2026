import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
}

async function addSheet(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "New Table", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  return errors;
}

test("collapsed sidebar pops up group submenu and switches table", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await openApp(page);

  // 准备第二张表（展开态新建）。
  await addSheet(page);
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 2");

  // 折叠侧边栏到 36px 窄条。
  await page
    .getByRole("button", { name: "Toggle sidebar" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".ant-layout-sider")).toHaveClass(
    /ant-layout-sider-collapsed/,
  );

  // 折叠窄条出现分组图标入口（Menu 收缩为 .ant-menu-inline-collapsed）。
  const collapsedMenu = page.locator(
    ".ant-layout-sider .ant-menu-inline-collapsed",
  );
  await expect(collapsedMenu).toBeVisible();

  // 悬停 holding-register 分组 -> 弹出子菜单列出该组表项。
  await collapsedMenu.locator(".ant-menu-submenu-title").first().hover();
  const popup = page.locator(".ant-menu-submenu-popup:visible");
  await expect(popup).toContainText("Sheet 1");
  await expect(popup).toContainText("Sheet 2");

  // 点击「Sheet 1」（此时活动表为新建的 Sheet 2）切换到该表（页签栏活动表跟随）。
  await popup.locator(".sheet-item", { hasText: "Sheet 1" }).first().click();
  await expect(
    page.locator(".register-table-tabs .ant-tabs-tab-active"),
  ).toContainText("Sheet 1");

  // 全程无 console 错误。
  expect(errors).toEqual([]);
});

test("collapsed sidebar centers group icons and does not overflow horizontally", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await openApp(page);

  await page
    .getByRole("button", { name: "Toggle sidebar" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".ant-layout-sider")).toHaveClass(
    /ant-layout-sider-collapsed/,
  );

  // 折叠窄条几何：
  //  - 分组图标中心须与顶部折叠按钮中心同一竖轴（= 窄条内容区中线）；
  //  - `.sheet-sidebar__groups` 不得横向溢出。
  const geometry = await page.evaluate(() => {
    const strip = document.querySelector<HTMLElement>(".sheet-sidebar");
    const button = document.querySelector<HTMLElement>(
      ".sheet-sidebar__collapse",
    );
    const groups = document.querySelector<HTMLElement>(
      ".sheet-sidebar__groups",
    );
    if (strip === null || button === null || groups === null) return null;
    const stripRect = strip.getBoundingClientRect();
    const centerOf = (rect: DOMRect): number =>
      rect.left - stripRect.left + rect.width / 2;
    const titleSelector =
      ".sheet-sidebar__menu.ant-menu-inline-collapsed .ant-menu-submenu-title";
    return {
      axisCenter: centerOf(button.getBoundingClientRect()),
      titleCount: document.querySelectorAll(titleSelector).length,
      // 每个分组标题的 DOM 里除**分组图标**外还有一个隐藏的展开箭头（同为 `.anticon`、零尺寸），
      // 故只统计可见图标（宽高 > 0），排除零尺寸的展开箭头。
      iconCenters: [
        ...document.querySelectorAll<HTMLElement>(`${titleSelector} .anticon`),
      ]
        .map((icon) => icon.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map(centerOf),
      scrollWidth: groups.scrollWidth,
      clientWidth: groups.clientWidth,
    };
  });

  expect(geometry).not.toBeNull();
  const { axisCenter, titleCount, iconCenters, scrollWidth, clientWidth } =
    geometry ?? {
      axisCenter: 0,
      titleCount: 0,
      iconCenters: [],
      scrollWidth: 0,
      clientWidth: 0,
    };
  // 每个分组都有图标入口（防空数组「假通过」）。
  expect(titleCount).toBeGreaterThan(0);
  expect(iconCenters).toHaveLength(titleCount);
  for (const iconCenter of iconCenters) {
    expect(Math.abs(iconCenter - axisCenter)).toBeLessThanOrEqual(1);
  }
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

  // 无 console 错误。
  expect(errors).toEqual([]);
});
