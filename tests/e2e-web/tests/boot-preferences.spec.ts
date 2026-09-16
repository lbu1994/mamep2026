/**
 * 首屏偏好（主题 / 语言）应用时序 e2e（mockTransport=1，浏览器端，2026-09-16）。
 *
 * **Bug**（ToDoList 阶段二 `[bug] 暗黑模式 / 语言刷新 FOUC`）：刷新网页时先按「明亮模式 /
 * 默认语言（en-US）」渲染，随后才切换为已保存的暗黑模式 / 中文 —— 偏好的唯一事实源是
 * **异步加载**的工作区（`workspace.preferences.theme / themePrimary / language`），而
 * `main.tsx` 首屏渲染时 store 只有默认值（`theme: "light"` + i18n `lng: "en-US"`），
 * 要等宿主装配 + 仓储读取完成后（`setWorkspace`）才回填。
 *
 * **复现（红）**：切暗色 + 中文 → 等自动保存 → 注册记录器 → reload；
 * 记录器在「`#root` 首次出现子节点」（= 首帧渲染完成）时抓取 `<html data-mamep-theme>` 与
 * `<html lang>`。修复前：此刻 `data-mamep-theme` 尚未设置（`useEffect` 在首次绘制之后才跑）、
 * `lang` 仍是 `index.html` 硬编码的 `en` → 两条断言失败。
 *
 * **修复（绿）**：首屏渲染前 hydrate 持久化偏好（localStorage 缓存 `mamep:preferences`）→
 * 首帧渲染时标记即为已保存值，且主题标记序列中**不出现** `light`（无明亮 → 暗色跳变）。
 *
 * 全程无 console 错误。
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173/?mockTransport=1";
/** 首屏偏好缓存键（与 `apps/web/src/boot-preferences.ts` 同源）。 */
const CACHE_KEY = "mamep:preferences";

/** 记录器写入 `window.__mamepBoot` 的结构。 */
interface BootRecord {
  marked: boolean;
  themeAtFirstRender: string | null;
  langAtFirstRender: string | null;
  themeSequence: Array<string | null>;
  langSequence: Array<string | null>;
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

/** 打开 Settings 抽屉（容器为 Drawer，2026-09-12）。 */
async function openSettings(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Settings" })
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".settings-drawer.ant-drawer-open")).toHaveCount(1);
}

/** 关闭 Settings 抽屉（等离场动画结束，避免后续点击落在仍在收起的遮罩上）。 */
async function closeSettings(page: Page): Promise<void> {
  await page.locator(".settings-drawer .ant-drawer-close").first().click();
  await expect(
    page.locator(".settings-drawer .ant-drawer-content-wrapper"),
  ).toBeHidden();
}

/** 在 Settings 内切到深色主题（General 页签的 Light/Dark Segmented）。 */
async function selectDarkTheme(page: Page): Promise<void> {
  await page
    .locator(".settings-drawer .ant-segmented-item-label")
    .filter({ hasText: "Dark" })
    .first()
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-mamep-theme", "dark");
}

/** 在 Settings 内切到中文（当前显示 English 的语言下拉）。 */
async function selectChinese(page: Page): Promise<void> {
  await page
    .locator(".settings-drawer .ant-select")
    .filter({ hasText: "English" })
    .first()
    .click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: "中文" })
    .first()
    .click();
}

/**
 * 注册首屏记录器（addInitScript：本次及后续导航的文档创建时执行）。
 * 记录两类事实：
 * - `themeSequence` / `langSequence`：`<html>` 上两个标记的变化序列（可看出是否出现过明亮）；
 * - `themeAtFirstRender` / `langAtFirstRender`：`#root` 首次出现子节点那一刻的标记值
 *   （= 首帧渲染时的状态，即用户看到的「首屏」）。
 */
async function installBootRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const record: BootRecord = {
      marked: false,
      themeAtFirstRender: null,
      langAtFirstRender: null,
      themeSequence: [],
      langSequence: [],
    };
    (window as unknown as { __mamepBoot: BootRecord }).__mamepBoot = record;

    const start = (): void => {
      const html = document.documentElement;
      if (html === null) {
        setTimeout(start, 0);
        return;
      }
      record.themeSequence.push(html.getAttribute("data-mamep-theme"));
      record.langSequence.push(html.lang);
      new MutationObserver(() => {
        const theme = html.getAttribute("data-mamep-theme");
        if (record.themeSequence[record.themeSequence.length - 1] !== theme) {
          record.themeSequence.push(theme);
        }
        if (record.langSequence[record.langSequence.length - 1] !== html.lang) {
          record.langSequence.push(html.lang);
        }
      }).observe(html, {
        attributes: true,
        attributeFilter: ["data-mamep-theme", "lang"],
      });

      const watchRoot = (): void => {
        const root = document.getElementById("root");
        if (root === null) return;
        const mark = (): void => {
          if (record.marked || root.childElementCount === 0) return;
          record.marked = true;
          record.themeAtFirstRender = html.getAttribute("data-mamep-theme");
          record.langAtFirstRender = html.lang;
        };
        mark();
        new MutationObserver(mark).observe(root, { childList: true });
      };
      watchRoot();
      // `#root` 在 document_start 尚未解析出来，靠文档级观察等待其出现。
      new MutationObserver(watchRoot).observe(document, {
        childList: true,
        subtree: true,
      });
    };
    start();
  });
}

function readBootRecord(page: Page): Promise<BootRecord> {
  return page.evaluate(
    () => (window as unknown as { __mamepBoot: BootRecord }).__mamepBoot,
  );
}

test("刷新后首帧渲染即已保存的主题 / 语言（无 FOUC）", async ({ page }) => {
  const errors = await openApp(page);
  await openSettings(page);
  await selectDarkTheme(page);
  await selectChinese(page);
  await closeSettings(page);
  // 等自动保存（IndexedDB 防抖 500ms）落盘，再刷新。
  await page.waitForTimeout(1000);

  await installBootRecorder(page);
  await page.reload();
  // 中文界面 + 已连接（mock）：确认应用已就绪（此刻早已是「已保存偏好」）。
  await expect(page.locator(".ant-layout-header")).toContainText("断开", {
    timeout: 15000,
  });

  const record = await readBootRecord(page);
  // 关键断言（修复红 / 绿分界）：首帧渲染时标记已是已保存偏好。
  expect(record.themeAtFirstRender).toBe("dark");
  expect(record.langAtFirstRender).toBe("zh-CN");
  // 全程未出现过「明亮」主题标记（无 明亮 → 暗色 跳变）。
  expect(record.themeSequence).not.toContain("light");
  expect(record.langSequence).not.toContain("en-US");

  // 首屏偏好缓存已写入（供下次刷新同步读取）。
  const cached = await page.evaluate((key) => localStorage.getItem(key), CACHE_KEY);
  expect(cached).not.toBeNull();
  expect(JSON.parse(String(cached))).toMatchObject({
    theme: "dark",
    language: "zh-CN",
    themePrimary: null,
  });

  expect(errors).toEqual([]);
});

test("首次访问（无缓存）：首帧为默认明亮 + en-US", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`);
  });
  await installBootRecorder(page);
  await page.goto(BASE_URL);
  await expect(page.locator(".ant-layout-header")).toContainText("Disconnect", {
    timeout: 15000,
  });

  const record = await readBootRecord(page);
  // 无缓存时同样在首屏渲染前应用默认偏好（而非留空 / 沿用 index.html 的 en）。
  expect(record.themeAtFirstRender).toBe("light");
  expect(record.langAtFirstRender).toBe("en-US");
  expect(errors).toEqual([]);
});
