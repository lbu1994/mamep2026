/**
 * 崩溃后状态恢复（PRD §8.3 / ADR-049）浏览器 E2E（mockTransport=1）：
 * - 关闭丢数据：编辑后关闭/重载不丢数据（autosave 兜底 + flush best-effort）；
 * - 损坏恢复：预置损坏主记录 + 合法备份 → reload 恢复 + RecoveryBanner 展示（无需按钮）。
 * 全程无 console 错误。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";

async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  await page.goto(BASE_URL);
  // Mock 模式启动不弹 Connection Settings，自动连接后 header 出现 Disconnect 即就绪。
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  return errors;
}

function row(page: Page, index: number) {
  return page.locator(".ant-table-tbody tr[data-row-key]").nth(index);
}

/** 点击进入 Name 单元格编辑态，填入新名字并提交。 */
async function setName(page: Page, index: number, name: string): Promise<void> {
  const nameInput = row(page, index).getByLabel("Name");
  await nameInput.click();
  await nameInput.fill(name);
  await nameInput.press("Enter");
}

/** 写入 IndexedDB（mamep2026 库 / kv store）的 workspace 与 workspace-backup 键。 */
async function seedWorkspaceDb(
  page: Page,
  data: { main?: unknown; backup?: unknown },
): Promise<void> {
  await page.evaluate(async ({ main, backup }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("mamep2026", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("kv");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction("kv", "readwrite");
    const store = tx.objectStore("kv");
    if (main !== undefined) store.put(main, "workspace");
    if (backup !== undefined) store.put(backup, "workspace-backup");
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }, data);
}

/** 读取 IndexedDB 中当前主记录内容（供构造备份）。 */
async function readWorkspaceMain(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    return new Promise<unknown>((resolve, reject) => {
      const req = indexedDB.open("mamep2026", 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("kv", "readonly");
        const get = tx.objectStore("kv").get("workspace");
        get.onsuccess = () => {
          db.close();
          resolve(get.result);
        };
        get.onerror = () => reject(get.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

test("关闭丢数据：编辑后关闭/重载不丢数据（autosave 兜底 + flush best-effort）", async ({
  page,
}) => {
  const errors = await openApp(page);
  // 目标行（默认 mock 场景第一行）改名。
  await setName(page, 0, "FlushName");
  // 等待 autosave（debounce 500ms）+ flush 完成落盘（flush 为 best-effort，
  // 详见 ADR-049 决策点 3：浏览器 unload 会中断异步 IndexedDB 写入，故以 autosave 兜底）。
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  // 恢复后第一行 Name 单元格仍显示 FlushName（非编辑态为静态文本）。
  await expect(row(page, 0)).toContainText("FlushName");
  expect(errors).toEqual([]);
});

test("损坏恢复：损坏主记录 + 合法备份 → reload 恢复 + RecoveryBanner", async ({
  page,
}) => {
  const errors = await openApp(page);
  // 等待应用把默认工作区自动保存到 IndexedDB（作为合法备份基础）。
  await page.waitForTimeout(800);
  const main = await readWorkspaceMain(page);
  // 构造备份（合法主记录）并破坏主记录。
  await seedWorkspaceDb(page, {
    main: { schemaVersion: "broken" },
    backup: main,
  });
  await page.reload();
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });
  // RecoveryBanner 展示（恢复数据来自备份），且无恢复失败横幅。
  const banner = page.getByTestId("recovery-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("recovered from backup");
  expect(errors).toEqual([]);
});
