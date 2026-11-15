import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
}

function sidebarItem(page: Page, name: string) {
  return page
    .locator(".ant-layout-sider li.sheet-item")
    .filter({ hasText: new RegExp(`^${name}$`) });
}

async function addSheet(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "New Table", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

test("sidebar shows workspace and register-table sections plus footer", async ({
  page,
}) => {
  await openApp(page);

  const sider = page.locator(".ant-layout-sider");
  await expect(sider).toContainText("Workspace");
  await expect(sider).toContainText("Tables");
  await expect(sider).toContainText("Sheet 1");
  // 版本信息（跟随根 package.json 版本，不断言具体版本号）。
  await expect(sider).toContainText(/Browser v\d+\.\d+\.\d+/);
});

test("top bar shows status chip, MOCK badge and Help", async ({ page }) => {
  await openApp(page);

  const header = page.locator(".ant-layout-header");
  // 新建入口只在侧栏 TABLES 分区，顶栏不放。
  await expect(header).not.toContainText("New Table");
  // 从站地址已迁移为每表独立设置，Header 不再显示 Slave。
  await expect(header).toContainText("Online");
  await expect(header).not.toContainText("Slave");
  await expect(header).toContainText("MOCK");
  await expect(header).toContainText("Help");

  await page
    .getByRole("button", { name: "Help" })
    .evaluate((el) => (el as HTMLElement).click());
  const drawer = page.locator(".ant-drawer-section:visible");
  await expect(drawer).toContainText("Help / About");
  await drawer
    .locator(".ant-drawer-close")
    .evaluate((el) => (el as HTMLElement).click());
});

test("register table tab bar shows the active sheet tab", async ({ page }) => {
  await openApp(page);

  await expect(
    page.locator(".register-table-tabs .ant-tabs-tab-active"),
  ).toContainText("Sheet 1");
  await expect(
    page.locator(".register-table-tabs .ant-tabs-tab").first(),
  ).toContainText("Sheet 1");
});

test("sidebar context menu duplicates, moves and deletes sheets", async ({
  page,
}) => {
  await openApp(page);
  await addSheet(page);
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 2");

  // 右键 "Sheet 1"：菜单包含全部五项。
  await sidebarItem(page, "Sheet 1").click({ button: "right" });
  const menu = page.locator(".ant-dropdown:visible");
  await expect(menu).toContainText("Rename");
  await expect(menu).toContainText("Duplicate");
  await expect(menu).toContainText("Move Up");
  await expect(menu).toContainText("Move Down");
  await expect(menu).toContainText("Delete");
  // 首项：Move Up 禁用。
  await expect(page.getByRole("menuitem", { name: "Move Up" })).toHaveClass(
    /ant-dropdown-menu-item-disabled/,
  );
  await page.keyboard.press("Escape");

  // Duplicate：副本插入源表之后并激活，标题栏跟随。
  await sidebarItem(page, "Sheet 1").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Duplicate" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 1 Copy");
  await expect(page.locator("li.sheet-item--active")).toContainText(
    "Sheet 1 Copy",
  );
  await expect(
    page.locator(".register-table-tabs .ant-tabs-tab-active"),
  ).toContainText("Sheet 1 Copy");

  // Move Down：Sheet 1 → 第二位。
  await sidebarItem(page, "Sheet 1").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Move Down" })
    .evaluate((el) => (el as HTMLElement).click());
  const names = page.locator(
    ".ant-layout-sider li.sheet-item .sheet-item__name",
  );
  await expect(names.nth(0)).toHaveText("Sheet 1 Copy");
  await expect(names.nth(1)).toHaveText("Sheet 1");

  // Delete "Sheet 2"：确认弹窗后删除。
  await sidebarItem(page, "Sheet 2").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Delete" })
    .evaluate((el) => (el as HTMLElement).click());
  const confirm = page.locator(".ant-modal-container:visible");
  await expect(confirm).toContainText("Delete table");
  await confirm
    .locator(".ant-btn-primary")
    .evaluate((el) => (el as HTMLElement).click());
  await expect(
    page
      .locator(".ant-layout-sider li.sheet-item")
      .filter({ hasText: "Sheet 2" }),
  ).toHaveCount(0);
});

test("sidebar context menu shows Close Others and Close to the Right", async ({
  page,
}) => {
  await openApp(page);
  await addSheet(page);
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 2");

  await sidebarItem(page, "Sheet 1").click({ button: "right" });
  const menu = page.locator(".ant-dropdown:visible");
  await expect(menu).toContainText("Close Others");
  await expect(menu).toContainText("Close to the Right");
  await page.keyboard.press("Escape");
});

test("Close Others is disabled on a single table", async ({ page }) => {
  await openApp(page);

  // 单表：Close Others 与 Close to the Right 均禁用。
  await sidebarItem(page, "Sheet 1").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Close Others" }),
  ).toHaveClass(/ant-dropdown-menu-item-disabled/);
  await expect(
    page.getByRole("menuitem", { name: "Close to the Right" }),
  ).toHaveClass(/ant-dropdown-menu-item-disabled/);
});

test("Close to the Right is disabled on the last table", async ({ page }) => {
  await openApp(page);
  await addSheet(page);
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 2");

  // 两张表：末位表的 Close to the Right 禁用，Close Others 可用。
  await sidebarItem(page, "Sheet 2").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Close to the Right" }),
  ).toHaveClass(/ant-dropdown-menu-item-disabled/);
  await expect(
    page.getByRole("menuitem", { name: "Close Others" }),
  ).not.toHaveClass(/ant-dropdown-menu-item-disabled/);
});

test("Close Others keeps only the target table and activates it", async ({
  page,
}) => {
  await openApp(page);
  await addSheet(page);
  await addSheet(page);
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 3");

  // 右键 "Sheet 2" → Close Others → 确认弹窗。
  await sidebarItem(page, "Sheet 2").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close Others" })
    .evaluate((el) => (el as HTMLElement).click());
  const confirm = page.locator(".ant-modal-container:visible");
  await expect(confirm).toContainText("Close other tables");
  await expect(confirm).toContainText("Close the other 2 table(s)");
  await confirm
    .locator(".ant-btn-primary")
    .evaluate((el) => (el as HTMLElement).click());

  // 非破坏性：侧边栏仍保留全部表，仅目标打开且激活，其余为关闭态。
  const items = page.locator(".ant-layout-sider li.sheet-item");
  await expect(items).toHaveCount(3);
  await expect(page.locator("li.sheet-item--active")).toContainText("Sheet 2");
  await expect(
    page.locator(".ant-layout-sider li.sheet-item--closed"),
  ).toHaveCount(2);
  await expect(
    page.locator(".register-table-tabs .ant-tabs-tab-active"),
  ).toContainText("Sheet 2");
  await expect(page.getByRole("tab", { name: "Sheet 1" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Sheet 3" })).toHaveCount(0);
});

test("Close to the Right keeps left tables and activates the target", async ({
  page,
}) => {
  await openApp(page);
  await addSheet(page);
  await addSheet(page);
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 3");

  // 右键 "Sheet 2" → Close to the Right → 确认弹窗。
  await sidebarItem(page, "Sheet 2").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close to the Right" })
    .evaluate((el) => (el as HTMLElement).click());
  const confirm = page.locator(".ant-modal-container:visible");
  await expect(confirm).toContainText("Close tables to the right");
  await expect(confirm).toContainText("Close the 1 table(s) to the right");
  await confirm
    .locator(".ant-btn-primary")
    .evaluate((el) => (el as HTMLElement).click());

  // 非破坏性：侧边栏仍保留 3 张表，Sheet 3 关闭，Sheet 1/2 打开，目标 Sheet 2 激活。
  const names = page.locator(
    ".ant-layout-sider li.sheet-item .sheet-item__name",
  );
  await expect(names).toHaveCount(3);
  await expect(names.nth(0)).toHaveText("Sheet 1");
  await expect(names.nth(1)).toHaveText("Sheet 2");
  await expect(names.nth(2)).toHaveText("Sheet 3");
  await expect(page.locator("li.sheet-item--active")).toContainText("Sheet 2");
  await expect(
    page.locator(".ant-layout-sider li.sheet-item--closed"),
  ).toHaveCount(1);
  await expect(
    page.locator(".register-table-tabs .ant-tabs-tab-active"),
  ).toContainText("Sheet 2");
  await expect(page.getByRole("tab", { name: "Sheet 3" })).toHaveCount(0);
});

test("Close Others confirm cancels without effect and applies on OK", async ({
  page,
}) => {
  await openApp(page);
  await addSheet(page);
  await addSheet(page);
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 3");

  // Cancel：不生效。
  await sidebarItem(page, "Sheet 2").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close Others" })
    .evaluate((el) => (el as HTMLElement).click());
  let confirm = page.locator(".ant-modal-container:visible");
  await expect(confirm).toContainText("Close other tables");
  await confirm
    .getByRole("button", { name: "Cancel" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);
  await expect(page.locator(".ant-layout-sider li.sheet-item")).toHaveCount(3);

  // OK：生效。
  await sidebarItem(page, "Sheet 2").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close Others" })
    .evaluate((el) => (el as HTMLElement).click());
  confirm = page.locator(".ant-modal-container:visible");
  await expect(confirm).toContainText("Close other tables");
  await confirm
    .locator(".ant-btn-primary")
    .evaluate((el) => (el as HTMLElement).click());
  // 非破坏性：侧边栏仍保留全部表，其他表变为关闭态。
  await expect(page.locator(".ant-layout-sider li.sheet-item")).toHaveCount(3);
  await expect(
    page.locator(".ant-layout-sider li.sheet-item--closed"),
  ).toHaveCount(2);
});

test("deleting the last sheet recreates an empty Sheet 1", async ({ page }) => {
  await openApp(page);

  await sidebarItem(page, "Sheet 1").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Delete" })
    .evaluate((el) => (el as HTMLElement).click());
  const confirm = page.locator(".ant-modal-container:visible");
  await expect(confirm).toContainText("Delete table");
  await confirm
    .locator(".ant-btn-primary")
    .evaluate((el) => (el as HTMLElement).click());

  await expect(page.locator(".ant-layout-sider li.sheet-item")).toHaveCount(1);
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 1");
});

test("menu rename enters inline edit and updates title bar", async ({
  page,
}) => {
  await openApp(page);

  await sidebarItem(page, "Sheet 1").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Rename" })
    .evaluate((el) => (el as HTMLElement).click());
  const input = page.locator(".sheet-sidebar__list .sheet-item__input");
  await expect(input).toBeVisible();
  await input.fill("Inverter A");
  await input.press("Enter");
  await expect(page.locator(".ant-layout-sider")).toContainText("Inverter A");
  await expect(
    page.locator(".register-table-tabs .ant-tabs-tab-active"),
  ).toContainText("Inverter A");
});

test("tab bar context menu opens the sheet menu", async ({ page }) => {
  await openApp(page);

  // 右键标签页：打开与侧栏相同的表格菜单（标题栏无三点按钮）。
  await page.getByRole("tab", { name: "Sheet 1" }).click({ button: "right" });
  const menu = page.locator(".ant-dropdown:not(.ant-dropdown-hidden)");
  await expect(menu).toContainText("Rename");
  await expect(menu).toContainText("Duplicate");
  await expect(menu).toContainText("Close Others");
  await expect(menu).toContainText("Close to the Right");
  await expect(menu).toContainText("Move Up");
  await expect(menu).toContainText("Move Down");
  await expect(menu).toContainText("Delete");

  await page
    .getByRole("menuitem", { name: "Duplicate" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(
    page.locator(".register-table-tabs .ant-tabs-tab-active"),
  ).toContainText("Sheet 1 Copy");
  await expect(page.locator("li.sheet-item--active")).toContainText(
    "Sheet 1 Copy",
  );
});

test("sidebar items can be reordered by drag and drop", async ({ page }) => {
  await openApp(page);
  await addSheet(page);
  await expect(page.locator(".ant-layout-sider")).toContainText("Sheet 2");

  await page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll(".ant-layout-sider li.sheet-item"),
    );
    const source = items[0];
    const target = items[1];
    if (source === undefined || target === undefined) {
      throw new Error("missing sidebar items");
    }
    const dt = new DataTransfer();
    source.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }),
    );
    target.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      }),
    );
    target.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      }),
    );
  });

  const names = page.locator(
    ".ant-layout-sider li.sheet-item .sheet-item__name",
  );
  await expect(names.nth(0)).toHaveText("Sheet 2");
  await expect(names.nth(1)).toHaveText("Sheet 1");
});

test("tabs add, switch and close register table sheets", async ({ page }) => {
  await openApp(page);

  // 每个 Sheet 一个页签，初始激活 Sheet 1。
  await expect(page.getByRole("tab", { name: "Sheet 1" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // 页签栏不提供 "+" 新建入口（新建走侧边栏，避免与未来多表类型添加入口冲突）。
  await expect(
    page.locator(".register-table-tabs .ant-tabs-nav-list .ant-tabs-nav-add"),
  ).toHaveCount(0);

  // 侧边栏 "+" 新建 Sheet 2 并自动激活。
  await page
    .getByRole("button", { name: "New Table", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByRole("tab", { name: "Sheet 2" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // 点击页签切换回 Sheet 1。
  await page
    .getByRole("tab", { name: "Sheet 1" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByRole("tab", { name: "Sheet 1" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // 页签 "×" 关闭 Sheet 2：非破坏性关闭，无确认弹窗。
  await page
    .locator(".register-table-tabs .ant-tabs-tab", { hasText: "Sheet 2" })
    .locator(".ant-tabs-tab-remove")
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByRole("tab", { name: "Sheet 2" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Sheet 1" })).toHaveCount(1);
  await expect(page.locator(".ant-modal-container:visible")).toHaveCount(0);

  // 侧边栏仍保留 Sheet 2（关闭态），点击后重新打开并激活。
  await expect(
    page.locator(".ant-layout-sider li.sheet-item.sheet-item--closed"),
  ).toContainText("Sheet 2");
  await sidebarItem(page, "Sheet 2").click();
  await expect(page.getByRole("tab", { name: "Sheet 2" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.locator(".ant-layout-sider li.sheet-item--closed"),
  ).toHaveCount(0);
});
