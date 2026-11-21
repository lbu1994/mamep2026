import { initI18n, useAppStore } from "@mamep2026/ui/runtime";
import {
  applyBootPreferencesToDocument,
  DEFAULT_BOOT_PREFERENCES,
  preferencesFromState,
  readBootPreferences,
  resolveBootStorage,
  writeBootPreferences,
  type BootPreferences,
  type BootPreferencesDocument,
  type BootPreferencesStorage,
} from "./boot-preferences";

export interface HydrateBootPreferencesDeps {
  /** 存储（默认 `resolveBootStorage()`；显式传 null = 不使用缓存）。 */
  storage?: BootPreferencesStorage | null;
  /** 写 store 偏好（默认 `applyBootPreferencesToStore`）。 */
  setPreferences?: (preferences: BootPreferences) => void;
  /** 初始化 i18n（默认 `@mamep2026/ui` 的 `initI18n`）。 */
  initI18n?: (language: BootPreferences["language"]) => void;
  /** `<html>` 标记目标（默认 `document.documentElement`）。 */
  documentElement?: BootPreferencesDocument | null;
}

/**
 * 把首屏偏好写进 store。
 *
 * 语言必须同时落到 `workspace.preferences.language`，避免 MamepApp 的 `<html lang>`
 * effect 在正式工作区加载前把刚恢复的语言覆盖回默认值。
 */
export function applyBootPreferencesToStore(
  preferences: BootPreferences,
): void {
  useAppStore.setState((state) => ({
    theme: preferences.theme,
    themePrimary: preferences.themePrimary,
    themeColorSeed: preferences.themePrimarySeed,
    workspace: {
      ...state.workspace,
      preferences: {
        ...state.workspace.preferences,
        theme: preferences.theme,
        language: preferences.language,
        themePrimary: preferences.themePrimary,
      },
    },
  }));
}

/** 在完整 App 首次 render 前把缓存偏好同步到 Store、i18n 与 `<html>`。 */
export function hydrateBootPreferences(
  deps: HydrateBootPreferencesDeps = {},
): BootPreferences {
  const storage =
    deps.storage === undefined ? resolveBootStorage() : deps.storage;
  const preferences = readBootPreferences(storage) ?? DEFAULT_BOOT_PREFERENCES;

  (deps.setPreferences ?? applyBootPreferencesToStore)(preferences);
  (deps.initI18n ?? initI18n)(preferences.language);
  applyBootPreferencesToDocument(preferences, deps.documentElement);
  return preferences;
}

/** 订阅正式 Store 偏好变化并写回启动缓存。 */
export function installPreferencesCache(
  storage: BootPreferencesStorage | null = resolveBootStorage(),
): () => void {
  return useAppStore.subscribe((state, prevState) => {
    const next = preferencesFromState(state);
    const prev = preferencesFromState(prevState);
    if (
      next.theme === prev.theme &&
      next.themePrimary === prev.themePrimary &&
      next.themePrimarySeed === prev.themePrimarySeed &&
      next.language === prev.language
    ) {
      return;
    }
    writeBootPreferences(next, storage);
  });
}

/** 完整 App 模块就绪后、首次 render 前启动 Host 装配状态。 */
export function beginHostAssembly(): void {
  useAppStore.setState({ hostStatus: "assembling" });
}
