/**
 * 外壳界面状态「首帧即持久化值」e2e（mockTransport=1，浏览器端）。
 *
 * `.ant-layout-sider` / 已打开 Tab / 底部面板等**工作区派生**的界面状态必须在首帧直接
 * 使用持久化值。启动骨架覆盖 Host 装配与工作区完整恢复；外壳和表格分阶段提交，
 * 本用例记录“完整可交互外壳”首次出现时的状态。
 *
 * 验证：构造一组全非默认状态（多表 + 多行 + 活动 Tab + 侧栏折叠或拖宽 + 底部面板
 * 折叠或拖高 + 活动底部页签），记录外壳首次出现时的快照，与刷新前稳定态快照比对。
 *
 * 全程无 console 错误。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

/** 外壳快照读取表达式（**单一事实源**）：测试侧 `page.evaluate(string)`、记录器内嵌复用。 */
const SHELL_SNAPSHOT_EXPRESSION = `(() => {
  const sider = document.querySelector(".ant-layout-sider");
  const bottom = document.querySelector(".bottom-panel");
  const round = (value) => Math.round(value);
  const activeTab = document.querySelector(
    ".register-table-tabs .ant-tabs-tab-active .sheet-tab__label",
  );
  const activeBottom = document.querySelector(".bottom-panel .ant-tabs-tab-active");
  return {
    sidebarCollapsed:
      sider === null ? null : sider.classList.contains("ant-layout-sider-collapsed"),
    sidebarWidth: sider === null ? null : round(sider.getBoundingClientRect().width),
    sheetItems: document.querySelectorAll(".sheet-sidebar .sheet-item").length,
    tabCount: document.querySelectorAll(".register-table-tabs .ant-tabs-tab").length,
    activeTabLabel: activeTab === null ? "" : activeTab.textContent.trim(),
    rows: document.querySelectorAll(
      // 仅统计**活动面板**的行数：antd Tabs 的其余面板在首次激活前不挂载（懒挂载是预期行为，
      // 不是闪烁）——按全量统计会把「未挂载」误判为首帧差异。
      ".register-table-tabs .ant-tabs-content-active .ant-table-tbody .ant-table-row",
    ).length,
    bottomCollapsed:
      bottom === null ? null : bottom.classList.contains("bottom-panel--collapsed"),
    bottomHeight: bottom === null ? null : round(bottom.getBoundingClientRect().height),
    activeBottomTabLabel:
      activeBottom === null ? "" : activeBottom.textContent.trim(),
  };
})()`;

/** 首帧记录器：外壳首次出现时的快照 + 是否经过启动骨架。 */
const RECORDER_SCRIPT = `(() => {
  const record = { shellAtFirstAppearance: null, sawSkeleton: false };
  window.__mamepShellBoot = record;
  const readShell = () => ${SHELL_SNAPSHOT_EXPRESSION};
  let pollTimer = 0;
  const capture = () => {
    if (document.querySelector(".app-startup") !== null) record.sawSkeleton = true;
    if (record.shellAtFirstAppearance !== null) return;
  // 主壳先提交，寄存器表在下一帧挂载；记录“完整可交互外壳”首次出现的快照。
  if (document.querySelector('[data-startup-hydrated="true"]') === null) return;
    record.shellAtFirstAppearance = readShell();
    window.clearInterval(pollTimer);
  };
  const start = () => {
    if (document.documentElement === null) {
      setTimeout(start, 0);
      return;
    }
    capture();
    new MutationObserver(capture).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    // MutationObserver 在极快提交下可能与导航生命周期竞争；16ms 轮询只用于
    // 捕获首次完整外壳，命中后立即停止。
    pollTimer = window.setInterval(capture, 16);
  };
  start();
})();`;

interface ShellSnapshot {
  sidebarCollapsed: boolean | null;
  sidebarWidth: number | null;
  sheetItems: number;
  tabCount: number;
  activeTabLabel: string;
  rows: number;
  bottomCollapsed: boolean | null;
  bottomHeight: number | null;
  activeBottomTabLabel: string;
}

interface ShellBootRecord {
  shellAtFirstAppearance: ShellSnapshot | null;
  sawSkeleton: boolean;
}

/**
 * 逐字段比对首帧快照与稳定态快照（**除 `bottomHeight`**）。
 *
 * `bottomHeight` 单独用容差断言：antd `Splitter` 的首帧布局会先落在一个沉降中间值、次帧才
 * 采用受控 `size`（逐帧实测：持久化 280 → 首帧 239 → 次帧 280；**持久化为默认 200 时同样如此**
 * → 179 → 200）。这是 Splitter 自身的首帧布局行为，与持久化值恢复无关。
 */
function expectShellStateMatch(
  actual: ShellSnapshot | null,
  expected: ShellSnapshot,
  options: { ignoreVirtualRowCount?: boolean } = {},
): void {
  if (actual === null) throw new Error("shell never appeared");
  const {
    bottomHeight: actualHeight,
    rows: actualRows,
    ...actualRest
  } = actual;
  const {
    bottomHeight: expectedHeight,
    rows: expectedRows,
    ...expectedRest
  } = expected;
  expect(actualRest).toEqual(expectedRest);
  if (!options.ignoreVirtualRowCount) {
    expect(actualRows).toBe(expectedRows);
  }
  // 首帧高度允许沉降误差（范围保守），但必须已按持久化量级布局（非默认值）。
  expect(Math.abs((actualHeight ?? 0) - (expectedHeight ?? 0))).toBeLessThan(
    80,
  );
}

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
  await expect(
    page.locator('[data-startup-hydrated="true"]'),
  ).toHaveCount(1);
  return errors;
}

/** 读取当前外壳快照（与记录器同一份表达式）。 */
function readShellSnapshot(page: Page): Promise<ShellSnapshot> {
  return page.evaluate(SHELL_SNAPSHOT_EXPRESSION) as Promise<ShellSnapshot>;
}

function readShellBootRecord(page: Page): Promise<ShellBootRecord> {
  return page.evaluate(
    () =>
      (window as unknown as { __mamepShellBoot: ShellBootRecord })
        .__mamepShellBoot,
  );
}

async function dragSidebarRight(page: Page, offset: number): Promise<void> {
  const dragger = page.locator(".sidebar-panel__resize").first();
  const box = await dragger.boundingBox();
  if (box === null) throw new Error("sidebar resize handle missing");
  const startX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(startX, centerY);
  await page.mouse.down();
  await page.mouse.move(startX + offset, centerY, { steps: 10 });
  await page.mouse.up();
}

async function dragBottomPanelUp(page: Page, offset: number): Promise<void> {
  const dragger = page.locator(".bottom-panel__resize").first();
  const box = await dragger.boundingBox();
  if (box === null) throw new Error("bottom panel resize handle missing");
  const centerX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(centerX, startY);
  await page.mouse.down();
  await page.mouse.move(centerX, startY - offset, { steps: 5 });
  await page.mouse.up();
}

/** 经侧边栏分组「+」新建一张保持寄存器表（新表默认打开并成为活动表）。
 * 注意：核心组（holding-register）的「＋」aria-label 是 "New Table"；基础表/插件组用组标题。 */
async function addHoldingSheet(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "New Table", exact: true })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

async function addRow(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Add Row" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
}

async function toggleSidebar(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Toggle sidebar" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".ant-layout-sider")).toHaveClass(
    /ant-layout-sider-collapsed/,
  );
}

async function collapseBottomPanel(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Collapse panel" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".bottom-panel--collapsed")).toBeVisible();
}

/** 切换底部面板活动页签（未折叠时点击即生效）。 */
async function selectBottomTab(page: Page, name: string): Promise<void> {
  await page.locator(".bottom-panel").getByRole("tab", { name }).click();
  await expect(
    page.locator(".bottom-panel .ant-tabs-tab-active"),
  ).toContainText(name);
}

test("多表 / 活动 Tab / 行数据：刷新后外壳首帧即持久化状态", async ({
  page,
}) => {
  const errors = await openApp(page);
  // 非默认：Sheet 1 加两行 → 新建 Sheet 2 → 新建 Sheet 3（活动表）并再加两行，
  // 使「活动面板行数」既能区分默认工作区（50 行），也能验证行数据已就位。
  await addRow(page);
  await addRow(page);
  await addHoldingSheet(page);
  await addHoldingSheet(page);
  await addRow(page);
  await addRow(page);
  await expect(page.locator(".register-table-tabs .ant-tabs-tab")).toHaveCount(
    3,
  );

  // 等自动保存（IndexedDB 防抖 500ms）落盘后取「稳定态」快照。
  await page.waitForTimeout(1200);
  const settled = await readShellSnapshot(page);
  expect(settled.tabCount).toBe(3);
  expect(settled.rows).toBeGreaterThan(0);

  await page.addInitScript(RECORDER_SCRIPT);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
  await expect(
    page.locator('[data-startup-hydrated="true"]'),
  ).toHaveCount(1);

  const record = await readShellBootRecord(page);
  // 外壳首现必须晚于启动骨架（骨架窗口覆盖工作区加载）。
  expect(record.sawSkeleton).toBe(true);
  if (record.shellAtFirstAppearance === null) {
    const diagnostics = await page.evaluate(() => ({
      header: document.querySelector(".mamep-header") !== null,
      sider: document.querySelector(".ant-layout-sider") !== null,
      hydrated: [
        ...document.querySelectorAll("[data-startup-hydrated]"),
      ].map((element) => element.getAttribute("data-startup-hydrated")),
    }));
    throw new Error(`shell recorder did not settle: ${JSON.stringify(diagnostics)}`);
  }
  // 关键断言（红 / 绿分界）：外壳首现快照 == 刷新前稳定态快照（无「先默认后切换」）。
  expectShellStateMatch(record.shellAtFirstAppearance, settled);
  // 显式复核（避免「两边都错成一样」的假绿）。
  expect(record.shellAtFirstAppearance?.tabCount).toBe(3);
  expect(record.shellAtFirstAppearance?.activeTabLabel).toBe(
    settled.activeTabLabel,
  );
  expect(record.shellAtFirstAppearance?.rows).toBe(settled.rows);

  expect(errors).toEqual([]);
});

test("侧栏折叠 / 底部面板折叠 / 活动底部页签：刷新后首帧即持久化状态", async ({
  page,
}) => {
  const errors = await openApp(page);
  await addHoldingSheet(page);
  await addRow(page);
  await addRow(page);
  // 非默认底部页签（先切页签再折叠：切换会自动展开底部面板），随后折叠底部面板与侧栏。
  await selectBottomTab(page, "Comm Log");
  await collapseBottomPanel(page);
  await toggleSidebar(page);
  await expect(page.locator(".ant-layout-sider")).toHaveClass(
    /ant-layout-sider-collapsed/,
  );

  await page.waitForTimeout(1200);
  const settled = await readShellSnapshot(page);
  expect(settled.sidebarCollapsed).toBe(true);
  expect(settled.bottomCollapsed).toBe(true);
  expect(settled.activeBottomTabLabel).toContain("Comm Log");

  await page.addInitScript(RECORDER_SCRIPT);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
  await expect(
    page.locator('[data-startup-hydrated="true"]'),
  ).toHaveCount(1);

  const record = await readShellBootRecord(page);
  expect(record.sawSkeleton).toBe(true);
  expectShellStateMatch(record.shellAtFirstAppearance, settled);
  // 显式复核（避免「两边都错成一样」的假绿）。
  expect(record.shellAtFirstAppearance?.sidebarCollapsed).toBe(true);
  expect(record.shellAtFirstAppearance?.bottomCollapsed).toBe(true);
  expect(record.shellAtFirstAppearance?.tabCount).toBe(2);
  expect(record.shellAtFirstAppearance?.activeBottomTabLabel).toContain(
    "Comm Log",
  );

  expect(errors).toEqual([]);
});

test("侧栏宽度 / 底部面板高度：刷新后首帧即持久化值", async ({ page }) => {
  const errors = await openApp(page);
  await dragSidebarRight(page, 60);
  await dragBottomPanelUp(page, 80);

  await page.waitForTimeout(1200);
  const settled = await readShellSnapshot(page);
  // 拖拽确实改变了尺寸（否则断言无意义）。
  expect(settled.sidebarWidth).toBeGreaterThan(180);
  expect(settled.bottomHeight).toBeGreaterThan(240);

  await page.addInitScript(RECORDER_SCRIPT);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Online", {
    timeout: 15000,
  });
  await expect(
    page.locator('[data-startup-hydrated="true"]'),
  ).toHaveCount(1);

  const record = await readShellBootRecord(page);
  expect(record.sawSkeleton).toBe(true);
  expectShellStateMatch(record.shellAtFirstAppearance, settled, {
    // 虚拟表实际挂载行数会随底部面板高度和浏览器滚动条测量上下浮动 1 行；
    // 本用例验证尺寸持久化，不比较虚拟 DOM 行数。
    ignoreVirtualRowCount: true,
  });
  // 侧栏宽度首帧即精确到位（Splitter 水平方向的受控 size 首帧生效；对比见上方助手注释）。
  expect(record.shellAtFirstAppearance?.sidebarWidth).toBe(
    settled.sidebarWidth,
  );

  expect(errors).toEqual([]);
});
