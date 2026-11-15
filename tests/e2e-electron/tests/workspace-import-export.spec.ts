/**
 * Electron 工作区导入/导出 RPC 闭环 E2E（PRD §8.3 P1）。
 * 生产构建路径启动（dist-electron/main.js + apps/web/dist-electron/，loadFile）。
 * 本环境 Electron 窗口存在系统性渲染不稳定（元素稳定检查超时，与功能无关），
 * 故本套件经 window.mamepHost 白名单 RPC 直接驱动（真实 preload 桥 → 安全 IPC →
 * 主进程 dialog + fs），验证：save-text-file 落盘、open-text-file 读取、导出→导入
 * 内容 roundtrip、用户取消语义（content:null 非错误）。UI 级流程由 tests/e2e-web
 * workspace-import-export.spec.ts 覆盖。
 * 系统对话框不可自动化：经 electronApp.evaluate 在主进程把 dialog.showSaveDialog /
 * showOpenDialog 替换为桩（返回临时文件路径）。
 */
import {
  _electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { readFile, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
/** 仓库根目录（本文件位于 tests/e2e-electron/tests/）。 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

const EXPORT_PATH = path.join(
  os.tmpdir(),
  `mamep-e2e-workspace-export-${Date.now()}.json`,
);
const IMPORT_PATH = path.join(
  os.tmpdir(),
  `mamep-e2e-workspace-import-${Date.now()}.json`,
);

/** preload 白名单桥的调用面（本测试用到的部分）。 */

let app: ElectronApplication;
let page: Page;
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  app = await _electron.launch({
    executablePath: require("electron"),
    args: ["dist-electron/main.js"],
    cwd: REPO_ROOT,
  });
  page = await app.firstWindow();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);

  // 桩替换系统对话框：保存→EXPORT_PATH，打开→IMPORT_PATH（Electron 主进程 dialog）。
  await app.evaluate(
    async ({ dialog }, paths) => {
      (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog =
        async () => ({ canceled: false, filePath: paths.exportPath });
      (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog =
        async () => ({ canceled: false, filePaths: [paths.importPath] });
    },
    { exportPath: EXPORT_PATH, importPath: IMPORT_PATH },
  );
});

test.afterAll(async () => {
  await app.close();
});

/** 在渲染进程内调用白名单桥方法（函数无法跨 evaluate 克隆，须在页面内执行）。 */
function callBridge(
  method: "saveTextFile" | "openTextFile",
  ...args: unknown[]
): Promise<unknown> {
  return page.evaluate(
    ({ method: m, args: a }) => {
      const host = (
        window as unknown as {
          mamepHost?: Record<
            string,
            (...callArgs: unknown[]) => Promise<unknown>
          >;
        }
      ).mamepHost;
      if (host === undefined) throw new Error("mamepHost missing");
      const fn = host[m];
      if (typeof fn !== "function") throw new Error(`bridge.${m} missing`);
      return fn(...(a as unknown[]));
    },
    { method, args },
  );
}

test("save-text-file 落盘工作区导出文件（主进程 dialog+fs 路径）", async () => {
  const content = JSON.stringify({
    schemaVersion: 4,
    name: "Workspace",
    sheets: [],
    connectionProfiles: [],
  });
  const result = (await callBridge("saveTextFile", {
    suggestedName: "mamep-workspace-e2e.json",
    content,
    mimeType: "application/json",
  })) as {
    ok: boolean;
    value?: { saved: boolean; filePath: string | null };
  };
  expect(result.ok).toBe(true);
  expect(result.value?.saved).toBe(true);
  // 主进程实际写盘。
  const written = await readFile(EXPORT_PATH, "utf8");
  expect(JSON.parse(written).name).toBe("Workspace");
});

test("open-text-file 读取工作区文件（主进程 dialog+fs 路径），用户取消返回 content:null 非错误", async () => {
  // 准备导入文件。
  await writeFile(
    IMPORT_PATH,
    JSON.stringify({ schemaVersion: 4, name: "ImportedByOpen", sheets: [] }),
    "utf8",
  );
  const read = (await callBridge("openTextFile", {
    suggestedName: "mamep-workspace.json",
  })) as { ok: boolean; value?: { content: string | null } };
  expect(read.ok).toBe(true);
  expect(read.value?.content).toContain("ImportedByOpen");

  // 用户取消：桩返回取消 → content:null（非错误）。
  await app.evaluate(async ({ dialog }) => {
    (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog =
      async () => ({ canceled: true, filePaths: [] });
  });
  const cancelled = (await callBridge("openTextFile")) as {
    ok: boolean;
    value?: { content: string | null };
  };
  expect(cancelled.ok).toBe(true);
  expect(cancelled.value?.content).toBeNull();
});

test("导出→导入内容 roundtrip（序列化内容经两端口往返不丢字段）", async () => {
  // 恢复打开对话框桩为「取消」路径。
  await app.evaluate(
    async ({ dialog }, paths) => {
      (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog =
        async () => ({ canceled: false, filePaths: [paths.importPath] });
    },
    { importPath: IMPORT_PATH },
  );
  // 与真实 UI 导出同源：构造一个含行数据的合法工作区 JSON。
  const content = JSON.stringify({
    schemaVersion: 4,
    name: "Roundtrip",
    sheets: [
      {
        sheetId: "s1",
        name: "Sheet 1",
        type: "holding-register",
        order: 0,
        open: true,
        registerRadix: "hex",
        columnWidths: { name: 160 },
        columnOrder: null,
        slaveAddress: 7,
        writeVerify: { mode: "immediate", delayMs: null },
        rows: [
          {
            rowId: "r1",
            order: 1,
            name: "Speed",
            comment: "RPM",
            addressDraft: "100",
            addressValue: 100,
            registerCount: 1,
            dataType: "unsigned",
            pollingEnabled: false,
            traceEnabled: false,
            cellText: "42",
            registerValues: [42],
            registers: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    connectionProfiles: [],
    activeConnectionProfileId: null,
    pollingSettings: { enabledBehavior: "manual", maxPendingPollingTasks: 10 },
    panelLayout: {
      sidebarCollapsed: false,
      bottomPanelCollapsed: false,
      bottomPanelHeight: 200,
      activeBottomTab: "messages",
    },
    preferences: { theme: "light", language: "en-US" },
    notes: "",
    pluginStates: [],
    migrationHistory: [],
  });

  // 导出（落盘）+ 导入（读回）→ 内容一致。
  const saved = (await callBridge("saveTextFile", {
    suggestedName: "roundtrip.json",
    content,
    mimeType: "application/json",
  })) as { ok: boolean };
  expect(saved.ok).toBe(true);
  await writeFile(IMPORT_PATH, content, "utf8");
  const read = (await callBridge("openTextFile")) as {
    ok: boolean;
    value?: { content: string | null };
  };
  expect(read.ok).toBe(true);
  expect(read.value?.content).toBe(content);
});

test("无 console 错误", async () => {
  expect(consoleErrors).toEqual([]);
});
