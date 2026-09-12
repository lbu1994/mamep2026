/**
 * Electron 文件持久化 e2e（ADR-036，2026-08-30）：
 * - 能力矩阵翻转：filesystem === "full"；
 * - 修改工作区（新增表）→ 主进程自动保存落盘为 userData/workspace.json（含改动）；
 * - 关闭 → 同 userData 重启 → 会话恢复（新表仍在）；
 * - 预置损坏主文件 + 合法备份 → 启动从备份恢复（自愈写回）；
 * - 全程无 console 错误。
 * userData 经 MAMEP_USER_DATA_DIR 注入临时目录，不污染真实用户数据。
 */
import {
  _electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

let dirs: string[] = [];

async function makeUserDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mamep-userdata-"));
  dirs.push(dir);
  return dir;
}

async function launchApp(
  userDataDir: string,
): Promise<{ app: ElectronApplication; page: Page; consoleErrors: string[] }> {
  const consoleErrors: string[] = [];
  const app = await _electron.launch({
    executablePath: require("electron"),
    args: ["dist-electron/main.js"],
    cwd: REPO_ROOT,
    env: { ...process.env, MAMEP_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  await page.waitForLoadState("domcontentloaded");
  // 等待共享 UI 挂载（含 IndexedDB/工作区加载与自动保存防抖）。
  await page.waitForTimeout(1500);
  return { app, page, consoleErrors };
}

async function callBridge<T>(
  page: Page,
  method: string,
  ...args: unknown[]
): Promise<T> {
  return page.evaluate(
    ({ method: m, args: a }) => {
      const host = (
        window as unknown as {
          mamepHost?: Record<string, (...callArgs: unknown[]) => Promise<unknown>>;
        }
      ).mamepHost;
      if (host === undefined) throw new Error("mamepHost missing");
      const fn = host[m];
      if (typeof fn !== "function") throw new Error(`bridge.${m} missing`);
      return fn(...(a as unknown[]));
    },
    { method, args },
  ) as Promise<T>;
}

/** 关闭启动时自动弹出的 Connection Settings（非 mock 启动会弹窗）。 */
/** 关闭启动时自动弹出的 Connection Settings（非 mock 启动会弹窗）。 */
async function closeConnectionModal(page: Page): Promise<void> {
  const modal = page.locator(".ant-modal-container:visible");
  if ((await modal.count()) === 0) return;
  const cancel = modal.getByRole("button", { name: "Cancel" });
  if ((await cancel.count()) > 0) {
    await cancel.click();
    await expect(cancel).toBeHidden({ timeout: 5000 });
  } else {
    await page.keyboard.press("Escape");
  }
}

/** 轮询等待 userData 目录下 workspace.json 出现并包含期望文本（自动保存 debounce 500ms + 落盘）。 */

/** 轮询等待 userData 目录下 workspace.json 出现并包含期望文本（自动保存 debounce 500ms + 落盘）。 */
async function waitForWorkspaceFile(
  userDataDir: string,
  expected: string,
  timeoutMs = 10000,
): Promise<void> {
  const mainPath = path.join(userDataDir, "workspace.json");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const content = await readFile(mainPath, "utf8");
      if (content.includes(expected)) return;
    } catch {
      // 文件尚未写入，继续等待。
    }
    if (Date.now() > deadline) {
      throw new Error(
        `workspace.json 未在 ${timeoutMs}ms 内包含 "${expected}"`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

test.afterAll(async () => {
  for (const dir of dirs) {
    try {
      // maxRetries 兜底 Windows EBUSY（Electron/Chromium 关窗后短暂占用文件）。
      await rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 300,
      });
    } catch {
      // 忽略：残留临时目录由系统清理，不影响测试结论。
    }
  }
  dirs = [];
});

test("能力矩阵翻转：filesystem === full（主进程文件仓储）", async () => {
  const userDataDir = await makeUserDataDir();
  const { app, page } = await launchApp(userDataDir);
  try {
    const result = (await callBridge<{
      ok: boolean;
      value?: { filesystem: string };
    }>(page, "getCapabilities")) as { ok: boolean; value: { filesystem: string } };
    expect(result.ok).toBe(true);
    expect(result.value.filesystem).toBe("full");
  } finally {
    await app.close();
  }
});

test("修改工作区 → 主进程自动保存落盘为 userData/workspace.json", async () => {
  const userDataDir = await makeUserDataDir();
  const { app, page } = await launchApp(userDataDir);
  try {
    // 非 mock 启动自动弹出 Connection Settings：先关闭再操作表格。
    await closeConnectionModal(page);
    // 结构性操作：新增表（侧边栏 New Table）→ 触发自动保存。
    await page
      .getByRole("button", { name: "New Table", exact: true })
      .click();
    await expect(
      page.locator(".register-table-tabs .ant-tabs-tab-active"),
    ).toContainText("Sheet 2", { timeout: 5000 });
    // 自动保存落盘（debounce 500ms）→ 主文件包含新表名。
    await waitForWorkspaceFile(userDataDir, '"Sheet 2"');
    const content = await readFile(
      path.join(userDataDir, "workspace.json"),
      "utf8",
    );
    const parsed = JSON.parse(content) as { sheets: Array<{ name: string }> };
    expect(parsed.sheets.map((s) => s.name)).toContain("Sheet 2");
  } finally {
    await app.close();
  }
});

test("关闭后同 userData 重启 → 会话恢复（新表仍在）", async () => {
  const userDataDir = await makeUserDataDir();
  // 第一会话：关弹窗 → 新增表并等待落盘。
  const first = await launchApp(userDataDir);
  try {
    await closeConnectionModal(first.page);
    await first.page
      .getByRole("button", { name: "New Table", exact: true })
      .click();
    await expect(
      first.page.locator(".register-table-tabs .ant-tabs-tab-active"),
    ).toContainText("Sheet 2", { timeout: 5000 });
    await waitForWorkspaceFile(userDataDir, '"Sheet 2"');
  } finally {
    await first.app.close();
  }
  // 关窗后读取第一会话的 console 错误记录（避免关闭过程中的错误被漏掉）。
  const firstConsoleErrors = first.consoleErrors;

  // 第二会话：同 userData 重启，工作区从文件恢复。
  const second = await launchApp(userDataDir);
  try {
    await expect(
      second.page.locator(".ant-layout-sider"),
    ).toContainText("Sheet 2", { timeout: 5000 });
    await expect(
      second.page.locator(".register-table-tabs .ant-tabs-tab-active"),
    ).toContainText("Sheet 2");
    expect(firstConsoleErrors).toEqual([]);
    expect(second.consoleErrors).toEqual([]);
  } finally {
    await second.app.close();
  }
});

test("损坏主文件 + 合法备份 → 启动从备份恢复（自愈写回）", async () => {
  const userDataDir = await makeUserDataDir();
  // 第一会话：等待应用自身自动保存落盘（生成合法工作区 JSON 作为备份基础）。
  const first = await launchApp(userDataDir);
  try {
    await waitForWorkspaceFile(userDataDir, '"Sheet 1"');
  } finally {
    await first.app.close();
  }

  // 以应用生成的合法 JSON 为基础构造备份（改表名为 RecoveredSheet），并破坏主文件。
  const mainPath = path.join(userDataDir, "workspace.json");
  const raw = JSON.parse(await readFile(mainPath, "utf8")) as {
    sheets: Array<{ name: string }>;
  };
  raw.sheets[0]!.name = "RecoveredSheet";
  await writeFile(
    path.join(userDataDir, "workspace.json.bak"),
    JSON.stringify(raw),
    "utf8",
  );
  await writeFile(mainPath, "{ broken json !!!", "utf8");

  // 第二会话：启动从备份恢复（自愈写回）。
  const { app, page, consoleErrors } = await launchApp(userDataDir);
  try {
    await expect(page.locator(".ant-layout-sider")).toContainText(
      "RecoveredSheet",
      { timeout: 5000 },
    );
    // 恢复提示（ADR-049）：从备份恢复时展示 RecoveryBanner（纯信息、无按钮）。
    const banner = page.getByTestId("recovery-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("recovered from backup");
    // 自愈：主文件被备份内容写回。
    await waitForWorkspaceFile(userDataDir, '"RecoveredSheet"');
    const mainContent = await readFile(mainPath, "utf8");
    const parsed = JSON.parse(mainContent) as {
      sheets: Array<{ name: string }>;
    };
    expect(parsed.sheets.map((s) => s.name)).toContain("RecoveredSheet");
    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
