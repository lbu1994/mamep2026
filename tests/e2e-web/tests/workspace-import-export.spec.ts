/**
 * 工作区导入/导出 e2e（mockTransport=1，浏览器端，PRD §8.3 P1）。
 * 覆盖：
 * - 导出：Settings → Export Workspace 触发浏览器下载（Blob），文件名 mamep-workspace-*.json，
 *   内容为版本化 JSON（schemaVersion），含当前工作区行数据；
 * - 导出→导入 roundtrip：导出文件再导入后工作区恢复（行名等字段不丢）；
 * - 导入预览确认/取消：预览 Modal 摘要展示，确认替换、取消不替换；
 * - 坏文件：解析失败报错且当前工作区不被破坏；
 * - 全程无 console 错误。
 * 注意：隐藏文件输入框随 Settings 弹窗挂载（在弹窗体内），导入前必须先打开 Settings。
 */
import type { Download, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
}

function row(page: Page, index: number) {
  return page.locator(".ant-table-tbody [data-row-key]").nth(index);
}

/** 点击进入 Name 单元格编辑态，填入新名字并提交。 */
async function setName(page: Page, index: number, name: string): Promise<void> {
  const nameInput = row(page, index).getByLabel("Name");
  await nameInput.click();
  await nameInput.fill(name);
  await nameInput.press("Enter");
}

/**
 * 打开 Settings 抽屉（顶栏按钮），返回抽屉定位器。
 * 注意：开合类 `.ant-drawer-open` 在抽屉**根元素**上（antd v6 的 `className` 落在内容面板
 * `.ant-drawer-section`，故组件用 `rootClassName`）；关闭后根元素仍留在 DOM（仅内容 wrapper
 * 被置 `display:none`），因此开合判定一律用 `.settings-drawer.ant-drawer-open`。
 */
async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.waitForSelector(".settings-drawer.ant-drawer-open", {
    timeout: 5000,
  });
  return page
    .locator(".settings-drawer")
    .filter({ hasText: "Reset Workspace" });
}

/** 关闭 Settings 抽屉（点击抽屉右上角关闭按钮）。 */
async function closeSettings(page: Page): Promise<void> {
  await page.locator(".settings-drawer .ant-drawer-close").first().click();
  // 等离场动画结束：开合类即时移除，但内容 wrapper 要动画跑完才置 display:none；
  // 只等开合类会在动画期间继续操作（点击被遮罩/抽屉吞掉）→ 后续步骤失败。
  await expect(
    page.locator(".settings-drawer .ant-drawer-content-wrapper"),
  ).toBeHidden();
  await expect(page.locator(".settings-drawer.ant-drawer-open")).toHaveCount(0);
}

/** 读取下载文件全部内容（UTF-8）。 */
async function readDownload(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  if (stream === null) throw new Error("download stream unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** 经隐藏文件输入导入指定内容（浏览器端 workspaceImport === "upload" 路径）。 */
async function importWorkspaceFile(
  page: Page,
  name: string,
  content: string,
): Promise<void> {
  const input = page.locator('input[data-testid="workspace-import-file"]');
  await expect(input).toBeAttached();
  await input.setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(content, "utf8"),
  });
}

/** 导入预览确认 Modal：展示摘要（工作表名/表数/行数/连接数/格式版本）后点确认。 */
async function confirmImport(page: Page): Promise<void> {
  const preview = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Format version" });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "Import", exact: true }).click();
  await expect(preview).toBeHidden();
}

test("导出触发浏览器下载：文件名与版本化 JSON 内容", async ({ page }) => {
  await openApp(page);
  await setName(page, 0, "ExportedName");
  const settings = await openSettings(page);

  const downloadPromise = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Export Workspace" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^mamep-workspace-.*-\d{8}-\d{6}\.json$/,
  );

  const content = await readDownload(download);
  const data = JSON.parse(content) as {
    schemaVersion: number;
    name: string;
    sheets: Array<{ rows: Array<{ name: string }> }>;
  };
  expect(data.schemaVersion).toBeGreaterThanOrEqual(1);
  expect(data.name).toBe("Workspace");
  expect(data.sheets[0]?.rows[0]?.name).toBe("ExportedName");
});

test("导出→导入 roundtrip：导入后工作区恢复导出内容", async ({ page }) => {
  await openApp(page);
  await setName(page, 0, "ExportedName");

  // 导出当前工作区。
  const settings = await openSettings(page);
  const downloadPromise = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Export Workspace" }).click();
  const download = await downloadPromise;
  const exported = await readDownload(download);
  await closeSettings(page);

  // 修改工作区（与导出内容不同）。
  await setName(page, 0, "ChangedName");
  await expect(row(page, 0).getByLabel("Name")).toHaveText("ChangedName");

  // 打开 Settings 后导入导出文件：预览摘要 → 确认。
  await openSettings(page);
  await importWorkspaceFile(page, "mamep-workspace-roundtrip.json", exported);
  await confirmImport(page);
  await closeSettings(page);

  // 工作区被替换：行名恢复为导出时的值。
  await expect(row(page, 0).getByLabel("Name")).toHaveText("ExportedName", {
    timeout: 5000,
  });
});

test("导入预览取消不替换当前工作区", async ({ page }) => {
  await openApp(page);
  await setName(page, 0, "KeepMe");
  const settings = await openSettings(page);

  // 先用导出得到合法工作区 JSON（手写 JSON 易缺必填字段导致解析失败）。
  const downloadPromise = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Export Workspace" }).click();
  const download = await downloadPromise;
  const valid = await readDownload(download);

  await importWorkspaceFile(page, "cancel.json", valid);
  const preview = page
    .locator(".ant-modal-container")
    .filter({ hasText: "Format version" });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(preview).toBeHidden();
  await closeSettings(page);

  // 工作区未被替换：行名保持。
  await expect(row(page, 0).getByLabel("Name")).toHaveText("KeepMe");
});

test("坏文件（非法 JSON）报错且不破坏当前工作区", async ({ page }) => {
  await openApp(page);
  await setName(page, 0, "KeepMe");
  await openSettings(page);

  await importWorkspaceFile(page, "bad.json", "not-json{{{");
  await expect(page.getByText("Import failed.")).toBeVisible();
  await closeSettings(page);
  await expect(row(page, 0).getByLabel("Name")).toHaveText("KeepMe");
});

test("导入含 connectionProfiles 的工作区：Connection Settings 恢复连接参数（替代原 Import JSON 路径）", async ({
  page,
}) => {
  await openApp(page);
  const settings = await openSettings(page);

  // 导出当前工作区 JSON，注入含自定义 baudRate 的 RTU 连接对象后重新导入。
  // 原「Connection Settings → Import JSON…」已移除，连接对象导入由工作区导入承担。
  const downloadPromise = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Export Workspace" }).click();
  const download = await downloadPromise;
  const exported = await readDownload(download);
  const data = JSON.parse(exported) as { connectionProfiles: unknown[] };
  data.connectionProfiles = [
    {
      id: "conn-e2e-rtu",
      name: "E2E RTU",
      protocol: "rtu",
      baudRate: 19200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "off",
      requestTimeoutMs: 1000,
      retryCount: 1,
      recentPortHint: null,
    },
  ];
  await importWorkspaceFile(page, "with-profile.json", JSON.stringify(data));
  await confirmImport(page);
  await closeSettings(page);

  // 打开 Connection Settings：默认表单值来自 connectionProfiles[0]（baudRate=19200）。
  await page
    .getByRole("button", { name: "Connection settings" })
    .evaluate((el) => (el as HTMLElement).click());
  await page.waitForSelector(".ant-modal-container:visible", { timeout: 5000 });
  const modal = page.locator(".ant-modal-container:visible");
  await expect(
    modal
      .locator(".ant-form-item")
      .filter({ hasText: "Speed" })
      .getByText("19200"),
  ).toBeVisible();
  // 导入入口已移除：弹窗内不再出现「Import JSON…」按钮。
  await expect(modal.getByText("Import JSON…")).toHaveCount(0);
});
