import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
}

async function sidebarBox(page: Page): Promise<{ x: number; width: number }> {
  const box = await page.locator(".ant-layout-sider").boundingBox();
  if (box === null) throw new Error("sidebar not visible");
  return { x: box.x, width: box.width };
}

/** 按住水平分隔条向右拖 offset 像素（展开态）。 */
async function dragSidebarRight(page: Page, offset: number): Promise<void> {
  const dragger = page.locator(".sidebar-panel__resize").first();
  const box = await dragger.boundingBox();
  if (box === null) throw new Error("resize handle missing");
  const startX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(startX, centerY);
  await page.mouse.down();
  await page.mouse.move(startX + offset, centerY, { steps: 10 });
  await page.mouse.up();
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  return errors;
}

test("expanded sidebar can be resized by dragging the splitter", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await openApp(page);

  const before = await sidebarBox(page);
  await dragSidebarRight(page, 60);

  const after = await sidebarBox(page);
  // 拖向右侧内容区 → 侧边栏变宽。
  expect(after.width).toBeGreaterThan(before.width + 20);
  // 宽度受 min/max 约束：不因拖拽突破边界。
  expect(after.width).toBeGreaterThanOrEqual(120);
  expect(errors).toEqual([]);
});

test("sidebar width persists after reload", async ({ page }) => {
  await openApp(page);

  await dragSidebarRight(page, 60);
  const dragged = await sidebarBox(page);
  // 面板宽度应已持久化到 panelLayout（> 默认 160 才证明写入生效）。
  expect(dragged.width).toBeGreaterThan(180);

  // 等待 IndexedDB 自动保存落盘（防抖 500ms，留 1s 余量）。
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });

  const restored = await sidebarBox(page);
  expect(Math.abs(restored.width - dragged.width)).toBeLessThanOrEqual(3);
});

test("collapsed sidebar is fixed at 36px and cannot be resized", async ({
  page,
}) => {
  await openApp(page);

  await page
    .getByRole("button", { name: "Toggle sidebar" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".ant-layout-sider")).toHaveClass(
    /ant-layout-sider-collapsed/,
  );

  const collapsed = await sidebarBox(page);
  // 折叠窄条固定 36px。
  expect(collapsed.width).toBeLessThanOrEqual(40);

  // 折叠态该面板 resizable=false → 分隔条不可拖，宽度保持不变。
  const dragger = page.locator(".sidebar-panel__resize").first();
  if ((await dragger.count()) > 0) {
    const box = await dragger.boundingBox();
    if (box !== null) {
      const startX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      await page.mouse.move(startX, centerY);
      await page.mouse.down();
      await page.mouse.move(startX + 80, centerY, { steps: 10 });
      await page.mouse.up();
    }
  }

  const after = await sidebarBox(page);
  expect(Math.abs(after.width - collapsed.width)).toBeLessThanOrEqual(3);
});
