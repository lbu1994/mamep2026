/**
 * Android 构建产物代码分割验证（2026-09-13）——四端共用的「懒加载 + rolldown 默认分包」
 * 在 Capacitor WebView（**生产产物** `https://localhost`）下的回归。
 *
 * 为什么必须在本套件验证：浏览器 dev server（`test:e2e:web`）不打包，跑不出分包类问题
 * （2026-09-11 实测：自定义 `codeSplitting.groups` 把同一 npm 包的循环依赖切到不同 chunk
 * → Electron 生产构建整体白屏 `TypeError: Class extends value undefined`）。Android 与
 * Electron / VSCode / 浏览器共用同一份 `apps/web/vite.config.ts` 与同一套分包结果。
 *
 * 覆盖（ToDoList 阶段一 [verify] 条目）：
 * ① 入口 + 多个 chunk 均能加载、**单 chunk < 500 kB**（Vite 告警阈值，未压缩口径）、
 *    React 正常挂载（无 `Class extends value undefined` 类循环依赖症状）；
 * ② 懒加载覆盖层**按需加载**：打开前对应 chunk 不在已加载集合中，打开后才出现；
 * ③ 启动自动弹出 Connection Settings 不回归 + 全程无 console 错误。
 *
 * 说明：待办条目里的「Plugin Manager」弹窗已于 2026-09-12 并入 Settings（`SettingsDrawer`），
 * 实际懒加载覆盖层为 4 个：HelpDrawer / SettingsDrawer / WorkspaceImportModal / TraceWindow。
 * 其中 `WorkspaceImportModal` 在 Android 上**不可达**（`androidCapabilities.workspaceImport ===
 * "unsupported"`，文件导入属 Phase 4），故本用例断言其「点击给出能力提示 + 不加载其 chunk」，
 * 而非「能打开」；顺带验证 2026-09-13 修复的「能力不支持时不再静默无操作」。
 */
import { expect, test, type Locator } from "@playwright/test";
import {
  dismissConnectionSettings,
  openAppSession,
  type AppSession,
} from "../helpers/app";

/** Vite 的分包告警阈值（**未压缩** kB 口径，与 `pnpm build` 的告警一致）。 */
const MAX_CHUNK_BYTES = 500_000;

/** 懒加载覆盖层对应的产物 chunk 名前缀（rolldown 以源文件名为动态 import chunk 命名）。 */
const LAZY_CHUNK_PREFIXES = [
  "HelpDrawer-",
  "SettingsDrawer-",
  "TraceWindow-",
  "WorkspaceImportModal-",
] as const;

interface LoadedChunk {
  /** 文件名（如 `HelpDrawer-CqQ-vuKf.js`）。 */
  name: string;
  /** 解码后字节数（未压缩口径，与 Vite 输出一致）。 */
  bytes: number;
}

let session: AppSession;

test.beforeAll(async () => {
  session = await openAppSession();
});

test.afterAll(async () => {
  await session?.close();
});

/**
 * 已加载的同源 JS chunk **文件名**（生产产物全部经 `https://localhost/assets/*.js` 提供）。
 *
 * 只取名字：Android WebView 的 resource timing **不填充 body size**
 *（`decodedBodySize` / `encodedBodySize` 恒为 0，2026-09-13 实测），故体积另用
 * {@link chunkSizes} 实测，避免「字节数与 0 比较」导致的假通过。
 */
async function loadedChunkNames(page: AppSession["page"]): Promise<string[]> {
  const names = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter(
        (entry) =>
          entry.name.includes("/assets/") && entry.name.endsWith(".js"),
      )
      .map((entry) => entry.name.split("/").pop() ?? ""),
  );
  // 同一 chunk 可能同时以 <script> 与 <link rel=modulepreload> 形式留下条目，去重后再计数。
  return [...new Set(names)];
}

/** 逐个 `fetch` 读真实字节数（同源、命中 WebView 缓存，代价小）。 */
async function chunkSizes(
  page: AppSession["page"],
  names: string[],
): Promise<LoadedChunk[]> {
  return page.evaluate(async (list: string[]) => {
    const results: { name: string; bytes: number }[] = [];
    for (const name of list) {
      const response = await fetch(`./assets/${name}`);
      const blob = await response.blob();
      results.push({ name, bytes: blob.size });
    }
    return results;
  }, names);
}

/** 等待某个懒加载 chunk 出现（动态 import 有网络往返，故轮询而非一次性读取）。 */
async function waitForChunk(
  page: AppSession["page"],
  prefix: string,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await loadedChunkNames(page)).some((name) => name.startsWith(prefix)),
      { timeout: 30_000, message: `等待懒加载 chunk「${prefix}*」加载` },
    )
    .toBe(true);
}

/** 关闭 antd 抽屉并等离场动画结束（动画期间遮罩会吞掉后续点击）。 */
async function closeDrawer(drawer: Locator): Promise<void> {
  await drawer.locator(".ant-drawer-close").first().click();
  await expect(drawer).not.toHaveClass(/ant-drawer-open/, { timeout: 10_000 });
  await drawer.page().waitForTimeout(600);
}

/**
 * 工作区导入/导出的能力提示（Android 上 `workspaceImport/workspaceExport` 均为
 * `unsupported`）。文案随工作区语言偏好，故中英双语匹配。
 */
function capabilityNotice(
  page: AppSession["page"],
  kind: "import" | "export",
): Locator {
  // 注意区分动词（Importing / Exporting）——两条提示可能同时在屏，
  // 若只用 “workspace file is not supported” 会同时命中两条 → strict mode violation。
  return page.getByText(
    kind === "import"
      ? /Importing a workspace file|当前环境不支持导入工作区文件/
      : /Exporting a workspace file|当前环境不支持导出工作区文件/,
  );
}

test("① 分包与启动：多 chunk 加载、单 chunk < 500 kB、React 挂载正常", async () => {
  const { page } = session;
  // openAppSession 已等到 `#root` 渲染出表格与启动的 Connection Settings 弹窗。
  const names = await loadedChunkNames(page);
  const chunks = await chunkSizes(page, names);
  const largest = chunks.reduce<LoadedChunk | null>(
    (worst, chunk) =>
      worst === null || chunk.bytes > worst.bytes ? chunk : worst,
    null,
  );
  const entry = chunks.find((chunk) => chunk.name.startsWith("index-")) ?? null;
  console.log(
    `[code-splitting] 首屏已加载 JS chunk=${chunks.length}；入口=${entry?.name ?? "?"}(${entry?.bytes ?? 0}B)；最大=${largest?.name ?? "?"}(${largest?.bytes ?? 0}B)`,
  );

  // React 真的挂载（循环依赖导致的白屏会连 `#root` 子节点都没有）。
  expect(await page.locator("#root > *").count()).toBeGreaterThan(0);
  await expect(page.locator(".register-table-tabs")).toBeVisible();

  // ③ 启动自动弹出 Connection Settings 不回归（Host 按平台懒加载后的装配路径）。
  await expect(page.locator(".ant-modal-container:visible")).toBeVisible();

  // ① 确实是分包产物：首屏即加载多个 chunk（单文件 1.7MB 时条目数极少）。
  expect(chunks.length).toBeGreaterThanOrEqual(10);
  expect(entry, "入口 chunk（index-*.js）应已加载").not.toBeNull();
  // ① 没有任何 chunk 超过 Vite 的 500 kB 告警阈值；bytes>0 同时守住「度量本身失效」
  // （Android WebView 的 resource timing body size 恒为 0，曾导致与 0 比较的假通过）。
  for (const chunk of chunks) {
    expect(chunk.bytes, `${chunk.name} = ${chunk.bytes}B`).toBeGreaterThan(0);
    expect(chunk.bytes, `${chunk.name} = ${chunk.bytes}B`).toBeLessThan(
      MAX_CHUNK_BYTES,
    );
  }
  // 无类循环依赖症状（同一 npm 包被切到不同 chunk 时的典型报错）。
  expect(
    session.consoleErrors.filter((message) =>
      message.includes("Class extends value"),
    ),
  ).toEqual([]);
});

test("② 懒加载覆盖层按需加载（Help / Settings / Trace Window；Import 在 Android 不可达）", async () => {
  const { page } = session;
  await dismissConnectionSettings(page);

  // 打开任何覆盖层之前：4 个懒加载 chunk 都不应在首屏加载（分包生效的判据）。
  const before = await loadedChunkNames(page);
  for (const prefix of LAZY_CHUNK_PREFIXES) {
    expect(
      before.some((name) => name.startsWith(prefix)),
      `首屏不应预加载 ${prefix}*`,
    ).toBe(false);
  }
  console.log(`[code-splitting] 首屏 chunk：${before.join(", ")}`);

  const topbar = page.locator(".mamep-header");
  // 移动布局（< 1024px）下 Settings / Help 收入顶栏「More」下拉；宽屏则为独立按钮。
  const openTopbarOverlay = async (
    item: "Settings" | "Help",
  ): Promise<void> => {
    const more = topbar.getByRole("button", { name: "More", exact: true });
    if ((await more.count()) > 0) {
      await more.click();
      await page.getByRole("menuitem", { name: item, exact: true }).click();
      return;
    }
    await topbar.getByRole("button", { name: item, exact: true }).click();
  };

  // —— Help 抽屉（懒加载 chunk 打开后才加载）——
  await openTopbarOverlay("Help");
  await waitForChunk(page, "HelpDrawer-");
  const helpDrawer = page.locator(".ant-drawer:has(.help-drawer)");
  await expect(helpDrawer).toHaveClass(/ant-drawer-open/);
  await closeDrawer(helpDrawer);

  // —— Settings 抽屉 ——
  await openTopbarOverlay("Settings");
  await waitForChunk(page, "SettingsDrawer-");
  const settingsDrawer = page.locator(".settings-drawer");
  await expect(settingsDrawer).toHaveClass(/ant-drawer-open/);

  // —— Workspace Import / Export：Android 能力位均为 `unsupported`（Phase 4 才接 SAF / 分享），
  // 故导入弹窗不可达 → 断言「给出能力提示（非静默无操作）+ 不加载其 chunk + 不报错」。
  await settingsDrawer
    .getByRole("button", { name: "Import Workspace" })
    .click();
  await expect(capabilityNotice(page, "import")).toBeVisible();
  await settingsDrawer
    .getByRole("button", { name: "Export Workspace" })
    .click();
  await expect(capabilityNotice(page, "export")).toBeVisible();
  expect(
    (await loadedChunkNames(page)).some((name) =>
      name.startsWith("WorkspaceImportModal-"),
    ),
    "Android 上工作区导入不可达：不应加载其 chunk",
  ).toBe(false);
  await closeDrawer(settingsDrawer);

  // —— Trace Window（行 TM 勾选即打开；用原生 click 规避移动端横向滚动/视口问题）——
  await page
    .locator('input[aria-label="TM"]')
    .first()
    .evaluate((element) => (element as HTMLElement).click());
  await waitForChunk(page, "TraceWindow-");
  await expect(page.locator(".trace-window")).toBeVisible();
  await page
    .locator(".trace-window")
    .getByRole("button", { name: "Close" })
    .click();
  await expect(page.locator(".trace-window")).toHaveCount(0);

  // ③ 全程无 console 错误。
  expect(session.consoleErrors).toEqual([]);
});
