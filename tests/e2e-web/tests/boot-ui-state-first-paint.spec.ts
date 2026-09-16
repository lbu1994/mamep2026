/**
 * 外壳界面状态「首帧即持久化值」e2e（mockTransport=1，浏览器端，2026-09-16）。
 *
 * **Bug**：`.ant-layout-sider` / 已打开 Tab / 底部面板等**工作区派生**的界面状态，在刷新后
 * 会先按 `createEmptyWorkspace()`（单张默认 `Sheet 1` + 默认 `panelLayout`）渲染，等工作区
 * 从宿主仓储异步加载完成后才切换 —— 侧栏折叠/宽度、底部面板折叠/高度/活动页签、打开的 Tab
 * 与活动 Tab 全部先错后对（首屏闪烁，范围远超主题 / 语言两项）。
 *
 * **复现（红）**：构造一组全非默认状态（多表 + 多行 + 活动 Tab + 侧栏折叠或拖宽 + 底部面板
 * 折叠或拖高 + 活动底部页签），记录「`#root` 首次渲染出外壳」（`.ant-layout-sider` 首次出现）
 * 那一刻的外壳快照，与刷新前稳定态快照比对。修复前首现快照 = 默认工作区（`Sheet 1` / 展开 /
 * Messages…）→ 断言失败。
 *
 * **修复（绿）**：启动骨架（`hostStatus === "assembling"`）覆盖到「工作区 + 插件就绪」之后
 * （见 `apps/web/src/host-assembly.ts`）→ 外壳首现即已加载完成，全部状态一步到位。
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
  const capture = () => {
    if (document.querySelector(".app-startup") !== null) record.sawSkeleton = true;
    if (record.shellAtFirstAppearance !== null) return;
    if (document.querySelector(".ant-layout-sider") === null) return;
    record.shellAtFirstAppearance = readShell();
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
    });
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
 * → 179 → 200）。这是 Splitter 自身的首帧布局行为，与「持久化值是否恢复」无关，
 * 故与本次修复分离、另立缺陷记录。
 */
function expectShellStateMatch(
  actual: ShellSnapshot | null,
  expected: ShellSnapshot,
): void {
  if (actual === null) throw new Error("shell never appeared");
  const { bottomHeight: actualHeight, ...actualRest } = actual;
  const { bottomHeight: expectedHeight, ...expectedRest } = expected;
  expect(actualRest).toEqual(expectedRest);
  // 首帧高度允许沉降误差（范围保守），但必须已按持久化量级布局（非默认值）。
  expect(Math.abs((actualHeight ?? 0) - (expectedHeight ?? 0))).toBeLessThan(80);
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

/** 读取当前外壳快照（与记录器同一份表达式）。 */
function readShellSnapshot(page: Page): Promise<ShellSnapshot> {
  return page.evaluate(SHELL_SNAPSHOT_EXPRESSION) as Promise<ShellSnapshot>;
}

function readShellBootRecord(page: Page): Promise<ShellBootRecord> {
  return page.evaluate(
    () => (window as unknown as { __mamepShellBoot: ShellBootRecord }).__mamepShellBoot,
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

test("多表 / 活动 Tab / 行数据：刷新后外壳首帧即持久化状态", async ({ page }) => {
  const errors = await openApp(page);
  // 非默认：Sheet 1 加两行 → 新建 Sheet 2 → 新建 Sheet 3（活动表）并再加两行，
  // 使「活动面板行数」既能区分默认工作区（50 行），也能验证行数据已就位。
  await addRow(page);
  await addRow(page);
  await addHoldingSheet(page);
  await addHoldingSheet(page);
  await addRow(page);
  await addRow(page);
  await expect(
    page.locator(".register-table-tabs .ant-tabs-tab"),
  ).toHaveCount(3);

  // 等自动保存（IndexedDB 防抖 500ms）落盘后取「稳定态」快照。
  await page.waitForTimeout(1200);
  const settled = await readShellSnapshot(page);
  expect(settled.tabCount).toBe(3);
  expect(settled.rows).toBe(52);

  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });

  const record = await readShellBootRecord(page);
  // 修复后外壳首现必须晚于启动骨架（骨架窗口覆盖工作区加载）。
  expect(record.sawSkeleton).toBe(true);
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

  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });

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

  await page.addInitScript({ content: RECORDER_SCRIPT });
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });

  const record = await readShellBootRecord(page);
  expect(record.sawSkeleton).toBe(true);
  expectShellStateMatch(record.shellAtFirstAppearance, settled);
  // 侧栏宽度首帧即精确到位（Splitter 水平方向的受控 size 首帧生效；对比见上方助手注释）。
  expect(record.shellAtFirstAppearance?.sidebarWidth).toBe(settled.sidebarWidth);

  expect(errors).toEqual([]);
});