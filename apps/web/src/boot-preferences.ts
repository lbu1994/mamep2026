/**
 * 首屏偏好缓存 + 渲染前 hydrate，避免刷新时主题 / 语言首屏闪烁。
 *
 * ## 为什么需要它
 * 偏好的唯一事实源是**工作区**（`workspace.preferences.theme / themePrimary / language`），
 * 而工作区由宿主仓储**异步**加载（浏览器 IndexedDB / Electron 主进程文件 + IPC / VSCode
 * 内嵌 IndexedDB / Android IndexedDB）。`main.tsx` 首屏渲染时 store 只有默认值
 * （`theme: "light"` + i18n `en-US`），要等宿主装配 + 仓储读取完成后（`setWorkspace`）才回填
 * ——于是「明亮 + 默认语言」必被画出，随后再跳变到已保存偏好。
 *
 * 本模块提供一份**可同步读取**的启动提示缓存（`localStorage`）：
 * - 写：`installPreferencesCache()` 订阅 store 的偏好（主题 / 主题色预设 / 主色种子 / 语言），
 * 变化即写回（含工作区加载 / 导入 / 重置后的 hydrate），保证缓存始终跟随用户最近一次选择；
 * - 读：`hydrateBootPreferences()` 在 `createRoot().render()` **之前**调用，把偏好落到
 * store（`theme` / `themePrimary`）、i18n 语言与 `<html data-mamep-theme>` / `<html lang>` 上。
 *
 * ## 边界
 * - 缓存**不是**事实源：工作区加载完成后仍由 `setWorkspace` 覆盖（两者一致，故无可见跳变）；
 * 工作区被外部改动时，最坏情况只是首帧用了旧偏好。
 * - 全程 best-effort：storage 不可用（隐私模式 / 被策略禁用）/ JSON 损坏 / 版本不符 / 字段非法
 * → 一律退回默认值，**不抛错、不影响任何流程**（与的 flush 同一态度）。
 * - 四端渲染器共用本模块（浏览器 / Electron / VSCode / Android），故放在 `apps/web`（组合根）：
 * `packages/ui` 保持不接触具体存储实现的平台无关性。
 */
import type { AppLanguage } from "@mamep2026/ui/runtime";

/** 缓存键（`localStorage`）。 */
export const BOOT_PREFERENCES_KEY = "mamep:preferences";

/** 载荷版本：结构变更时递增，旧版本一律视为无效（退回默认值）。 */
export const BOOT_PREFERENCES_VERSION = 1;

export type BootTheme = "light" | "dark";

/** 首屏需要应用的偏好（工作区 `preferences` 的启动子集）。 */
export interface BootPreferences {
  theme: BootTheme;
  /** 所选主题色预设：null=内置默认蓝；插件色 = `<pluginId>:<colorId>`。 */
  themePrimary: string | null;
  /**
   * `themePrimary` 上次**解析出**的主色（种子）：插件贡献晚于首帧到达，首帧用它
   * 过渡着色，避免「插件主题色先默认蓝再变插件色」。旧缓存无此字段 → null。
   */
  themePrimarySeed: string | null;
  language: AppLanguage;
}

export const DEFAULT_BOOT_PREFERENCES: BootPreferences = {
  theme: "light",
  themePrimary: null,
  themePrimarySeed: null,
  language: "en-US",
};

/** 同步存储面（`window.localStorage` 结构兼容；测试注入假实现）。 */
export interface BootPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `<html>` 上与偏好有关的标记面（结构类型：便于 node 环境单测注入）。 */
export interface BootPreferencesDocument {
  lang: string;
  dataset: Record<string, string | undefined>;
}

/** 取 `localStorage`；不可用（无 DOM / 隐私模式 / 被策略禁用）返回 null。 */
export function resolveBootStorage(): BootPreferencesStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // 访问 localStorage 属性本身在部分环境下会抛 SecurityError。
    return null;
  }
}

function resolveDocumentElement(): BootPreferencesDocument | null {
  try {
    return typeof document === "undefined" ? null : document.documentElement;
  } catch {
    return null;
  }
}

/** 解析缓存载荷（纯函数）：任何不合法输入返回 null，绝不抛出。 */
export function parseBootPreferences(
  raw: string | null,
): BootPreferences | null {
  if (raw === null || raw === "") return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const record = data as Record<string, unknown>;
  if (record.version !== BOOT_PREFERENCES_VERSION) return null;
  const { theme, language, themePrimary } = record;
  if (theme !== "light" && theme !== "dark") return null;
  if (language !== "en-US" && language !== "zh-CN") return null;
  if (themePrimary !== null && typeof themePrimary !== "string") return null;
  // 可选字段（旧缓存缺失 → null）：上次解析出的主色种子。
  const themePrimarySeed = record.themePrimarySeed ?? null;
  if (themePrimarySeed !== null && typeof themePrimarySeed !== "string") {
    return null;
  }
  return { theme, themePrimary, themePrimarySeed, language };
}

/** 读取缓存（缺失 / 损坏 / storage 抛错 → null）。 */
export function readBootPreferences(
  storage: BootPreferencesStorage | null = resolveBootStorage(),
): BootPreferences | null {
  if (storage === null) return null;
  try {
    return parseBootPreferences(storage.getItem(BOOT_PREFERENCES_KEY));
  } catch {
    return null;
  }
}

/** 写回缓存（失败静默：不影响功能，下次刷新退回默认值）。 */
export function writeBootPreferences(
  preferences: BootPreferences,
  storage: BootPreferencesStorage | null = resolveBootStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(
      BOOT_PREFERENCES_KEY,
      JSON.stringify({
        version: BOOT_PREFERENCES_VERSION,
        theme: preferences.theme,
        themePrimary: preferences.themePrimary,
        themePrimarySeed: preferences.themePrimarySeed,
        language: preferences.language,
      }),
    );
  } catch {
    // best-effort（配额 / 被禁）。
  }
}

/** store 中与首屏偏好相关的字段（结构类型：便于单测注入）。 */
export interface BootPreferencesState {
  theme: BootTheme;
  themePrimary: string | null;
  /** 上次解析出的主色种子（`MamepApp` 在插件就绪后回写）。 */
  themeColorSeed: string | null;
  workspace: { preferences: { language: AppLanguage } };
}

export function preferencesFromState(
  state: BootPreferencesState,
): BootPreferences {
  return {
    theme: state.theme,
    themePrimary: state.themePrimary,
    themePrimarySeed: state.themeColorSeed,
    language: state.workspace.preferences.language,
  };
}

/** 把缓存偏好同步落到文档根（不依赖 React / Store / i18n）。 */
export function applyBootPreferencesToDocument(
  preferences: BootPreferences,
  documentElement: BootPreferencesDocument | null = resolveDocumentElement(),
): void {
  if (documentElement === null) return;
  documentElement.dataset.mamepTheme = preferences.theme;
  documentElement.lang = preferences.language;
}
