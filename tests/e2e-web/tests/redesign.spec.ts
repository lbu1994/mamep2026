import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
}

test("messages panel shows translated text, not the raw i18n key", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.locator(".bottom-panel")).toContainText(
    "Application started (offline).",
  );
  await expect(page.locator(".bottom-panel")).not.toContainText(
    "messages.appStarted",
  );
});

test("empty sheet shows a guided empty state with an Add Row CTA", async ({
  page,
}) => {
  await openApp(page);
  // 默认表现在自带 defaultRowCount 行；先全选删除制造空表，再验证空态引导。
  await page
    .locator(".ant-table-thead .ant-table-selection-column .ant-checkbox-input")
    .click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".ant-empty")).toBeVisible();
  await expect(page.locator(".ant-empty")).toContainText(
    "Add registers to start monitoring.",
  );
  // 空表时页面只有唯一一个 "Add Row"（空状态 CTA），点击后出现寄存器输入。
  await page
    .getByRole("button", { name: "Add Row" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByLabel("Register").first()).toBeVisible();
});

test("sheet sidebar collapses and the state persists after reload", async ({
  page,
}) => {
  await openApp(page);
  const sider = page.locator(".ant-layout-sider");
  await expect(sider).toHaveCSS("width", "160px");
  await page
    .getByRole("button", { name: "Toggle sidebar" })
    .first()
    .evaluate((el) => (el as HTMLElement).click());
  await expect(sider).toHaveClass(/ant-layout-sider-collapsed/);
  // 等待自动保存后刷新，验证折叠状态持久化。
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  await expect(page.locator(".ant-layout-sider")).toHaveClass(
    /ant-layout-sider-collapsed/,
  );
});

test("bottom panel collapses to the tab bar and expands again", async ({
  page,
}) => {
  await openApp(page);
  const panel = page.locator(".bottom-panel");
  await expect(panel).toHaveCSS("height", "200px");
  await page
    .getByRole("button", { name: "Collapse panel" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".bottom-panel--collapsed")).toBeVisible();
  await expect(
    page.locator(".bottom-panel .ant-tabs-body-holder"),
  ).toBeHidden();
  // 折叠后标签栏仍可见。
  await expect(page.getByRole("tab", { name: /Messages/ })).toBeVisible();
  await page
    .getByRole("button", { name: "Expand panel" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(
    page.locator(".bottom-panel .ant-tabs-body-holder"),
  ).toBeVisible();
});

test("bottom panel height can be dragged and persists after reload", async ({
  page,
}) => {
  await openApp(page);
  const panel = page.locator(".bottom-panel");
  const handle = page.locator(".bottom-panel__resize");
  const heightOf = (): Promise<number> =>
    panel.evaluate((el) =>
      Math.round((el as HTMLElement).getBoundingClientRect().height),
    );

  const box =
    (await handle.boundingBox()) ?? { x: 0, y: 0, width: 100, height: 6 };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 80, { steps: 5 });
  await page.mouse.up();

  // 拖拽后高度应明显大于默认值 200。
  await expect.poll(heightOf).toBeGreaterThan(240);
  const draggedHeight = await heightOf();

  // 等待自动保存后刷新，验证高度持久化（与拖拽后高度一致）。
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  await expect.poll(heightOf).toBeGreaterThan(240);
  expect(Math.abs((await heightOf()) - draggedHeight)).toBeLessThanOrEqual(2);
});
