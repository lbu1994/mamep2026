/**
 * 快捷键注册表（PRD §8.3 P1「更完整的键盘操作」，2026-08-30，ADR-037）。
 *
 * 单一事实源：帮助弹窗（Help Modal 快捷键总览）与两级快捷键分发
 * （app 级 useGlobalShortcuts / 表格级 RegisterTable.handleGlobalKeyDown）共用本表，
 * 避免「文档里的快捷键」与「代码里的快捷键」漂移。
 *
 * 键位设计约束（浏览器/系统保留键规避，三端行为一致，ADR-037）：
 * - 不覆盖浏览器/系统保留组合：Ctrl+W/T/N/R、Ctrl+Tab、Ctrl+1..9、F5/F12、Alt+←/→ 等；
 * - macOS 用 mod（Ctrl 或 Meta）语义（沿用仓库 mod = ctrlKey || metaKey 惯例）；
 * - 所有快捷键在焦点位于文本输入控件 / 任一弹窗打开时一律不触发（见 guards.ts）。
 */

export interface ShortcutCombo {
  /**
   * 匹配 event.key（大小写不敏感）：单字符（如 ","、"?"）或 event.key 值小写
   * （如 "arrowup"、"arrowdown"、"f9"、"enter"）。
   */
  key: string;
  /** 需要 Ctrl 或 Meta（平台惯例）。与 ctrl/meta 互斥。 */
  mod?: boolean;
  /** 精确要求 Ctrl（且无 Meta）。 */
  ctrl?: boolean;
  /** 精确要求 Meta（且无 Ctrl）。 */
  meta?: boolean;
  /** 精确匹配 Shift（未指定 = 要求无 Shift，保证 Ctrl+Enter 与 Ctrl+Shift+Enter 可区分）。 */
  shift?: boolean;
  /** 精确匹配 Alt（未指定 = 要求无 Alt）。 */
  alt?: boolean;
}

export interface ShortcutDef {
  /** 稳定 id；i18n 文案键 = keyboard.<id>（见 shortcutI18nKey）。 */
  id: string;
  scope: "app" | "table";
  combo: ShortcutCombo;
  /** 帮助弹窗展示的按键文本（如 "Ctrl+,"、"F9"、"↑"）。 */
  comboLabel: string;
  /** 别名快捷键（如 "?" = Ctrl+/）：帮助弹窗不重复展示，测试断言指向有效 id。 */
  aliasOf?: string;
}

/** 快捷键 i18n 文案键：统一派生自 id（keyboard.<id>），避免双份维护漂移。 */
export function shortcutI18nKey(id: string): string {
  return `keyboard.${id}`;
}

/** 严格精确的修饰键匹配（未声明的修饰键必须为空，避免 Ctrl+Enter 命中 Ctrl+Shift+Enter 等）。 */
export function matchesShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
  >,
  combo: ShortcutCombo,
): boolean {
  if (event.key.toLowerCase() !== combo.key.toLowerCase()) return false;
  const hasMod = event.ctrlKey || event.metaKey;
  if (combo.mod !== undefined) {
    if (!hasMod) return false;
  } else if (combo.ctrl !== undefined) {
    if (!event.ctrlKey || event.metaKey) return false;
  } else if (combo.meta !== undefined) {
    if (!event.metaKey || event.ctrlKey) return false;
  } else if (hasMod) {
    return false;
  }
  if ((combo.shift ?? false) !== event.shiftKey) return false;
  if ((combo.alt ?? false) !== event.altKey) return false;
  return true;
}

/** App 级快捷键（MamepApp，经 useGlobalShortcuts 分发）。 */
export const APP_SHORTCUTS: ShortcutDef[] = [
  {
    id: "openSettings",
    scope: "app",
    combo: { key: ",", mod: true },
    comboLabel: "Ctrl+,",
  },
  {
    id: "toggleConnect",
    scope: "app",
    combo: { key: "enter", mod: true },
    comboLabel: "Ctrl+Enter",
  },
  {
    id: "openHelp",
    scope: "app",
    combo: { key: "/", mod: true },
    comboLabel: "Ctrl+/",
  },
  {
    id: "openHelpQuestion",
    scope: "app",
    combo: { key: "?", shift: true },
    comboLabel: "?",
    aliasOf: "openHelp",
  },
  {
    id: "prevSheet",
    scope: "app",
    combo: { key: "[", mod: true },
    comboLabel: "Ctrl+[",
  },
  {
    id: "nextSheet",
    scope: "app",
    combo: { key: "]", mod: true },
    comboLabel: "Ctrl+]",
  },
  {
    id: "newSheet",
    scope: "app",
    combo: { key: "n", mod: true, alt: true },
    comboLabel: "Ctrl+Alt+N",
  },
  {
    id: "closeSheet",
    scope: "app",
    combo: { key: "w", mod: true, alt: true },
    comboLabel: "Ctrl+Alt+W",
  },
  {
    id: "exportWorkspace",
    scope: "app",
    combo: { key: "s", mod: true, shift: true },
    comboLabel: "Ctrl+Shift+S",
  },
  {
    id: "importWorkspace",
    scope: "app",
    combo: { key: "o", mod: true, alt: true },
    comboLabel: "Ctrl+Alt+O",
  },
  {
    id: "toggleTheme",
    scope: "app",
    combo: { key: "t", mod: true, alt: true },
    comboLabel: "Ctrl+Alt+T",
  },
  {
    id: "focusCommLog",
    scope: "app",
    combo: { key: "l", mod: true, alt: true },
    comboLabel: "Ctrl+Alt+L",
  },
];

/** 表格级快捷键（RegisterTable.handleGlobalKeyDown 扩展，作用于活动表/选中行）。 */
export const TABLE_SHORTCUTS: ShortcutDef[] = [
  { id: "readAll", scope: "table", combo: { key: "f9" }, comboLabel: "F9" },
  {
    id: "readSelected",
    scope: "table",
    combo: { key: "f8" },
    comboLabel: "F8",
  },
  {
    id: "writeSelected",
    scope: "table",
    combo: { key: "enter", mod: true, shift: true },
    comboLabel: "Ctrl+Shift+Enter",
  },
  {
    id: "togglePolling",
    scope: "table",
    combo: { key: "p", alt: true },
    comboLabel: "Alt+P",
  },
  {
    id: "moveSelectionUp",
    scope: "table",
    combo: { key: "arrowup" },
    comboLabel: "↑",
  },
  {
    id: "moveSelectionDown",
    scope: "table",
    combo: { key: "arrowdown" },
    comboLabel: "↓",
  },
  {
    id: "restoreColumnLayout",
    scope: "table",
    combo: { key: "r", mod: true, alt: true },
    comboLabel: "Ctrl+Alt+R",
  },
];

export const ALL_SHORTCUTS: ShortcutDef[] = [
  ...APP_SHORTCUTS,
  ...TABLE_SHORTCUTS,
];

export type AppShortcutId = (typeof APP_SHORTCUTS)[number]["id"];
export type TableShortcutId = (typeof TABLE_SHORTCUTS)[number]["id"];
export type ShortcutId = (typeof ALL_SHORTCUTS)[number]["id"];

export const APP_SHORTCUT_MAP = Object.fromEntries(
  APP_SHORTCUTS.map((s) => [s.id, s]),
) as Record<AppShortcutId, ShortcutDef>;

export const TABLE_SHORTCUT_MAP = Object.fromEntries(
  TABLE_SHORTCUTS.map((s) => [s.id, s]),
) as Record<TableShortcutId, ShortcutDef>;

/** 表格级快捷键查找（运行时校验，避免 noUncheckedIndexedAccess 下索引返回 undefined）。 */
export function tableShortcut(id: TableShortcutId): ShortcutDef {
  const def = TABLE_SHORTCUT_MAP[id];
  if (def === undefined) {
    throw new Error(`unknown table shortcut: ${id}`);
  }
  return def;
}

/** App 级快捷键查找（运行时校验）。 */
export function appShortcut(id: AppShortcutId): ShortcutDef {
  const def = APP_SHORTCUT_MAP[id];
  if (def === undefined) {
    throw new Error(`unknown app shortcut: ${id}`);
  }
  return def;
}
