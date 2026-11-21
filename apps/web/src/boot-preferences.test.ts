/**
 * 首屏偏好缓存单测（node 环境；e2e 侧见
 * `tests/e2e-web/tests/boot-preferences.spec.ts`）。
 *
 * 覆盖：
 * - `parseBootPreferences` 的容错矩阵（坏 JSON / 版本不符 / 字段非法 → null，绝不抛出）；
 * - 读写 round-trip 与 storage 不可用（抛错 / null）时的静默降级；
 * - `hydrateBootPreferences` 的注入面（store / i18n / `<html>` 标记；无缓存 → 默认值）；
 * - `installPreferencesCache` 订阅 store 偏好变化并写回。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@mamep2026/ui";
import {
  BOOT_PREFERENCES_KEY,
  BOOT_PREFERENCES_VERSION,
  DEFAULT_BOOT_PREFERENCES,
  parseBootPreferences,
  readBootPreferences,
  writeBootPreferences,
  type BootPreferences,
  type BootPreferencesStorage,
} from "./boot-preferences";
import {
  hydrateBootPreferences,
  installPreferencesCache,
} from "./boot-preferences-hydrate";

const DARK_ZH: BootPreferences = {
  theme: "dark",
  themePrimary: "example-theme:indigo",
  themePrimarySeed: "#4f46e5",
  language: "zh-CN",
};

function payload(
  preferences: BootPreferences,
  version = BOOT_PREFERENCES_VERSION,
): string {
  return JSON.stringify({ version, ...preferences });
}

/** 内存假存储（node 环境无 localStorage）。 */
function makeStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  const storage: BootPreferencesStorage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
  return {
    storage,
    raw: (key: string): string | null => entries.get(key) ?? null,
  };
}

/** 抛错的存储（模拟隐私模式 / 被策略禁用）。 */
const throwingStorage: BootPreferencesStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("parseBootPreferences", () => {
  it("解析合法载荷", () => {
    expect(parseBootPreferences(payload(DARK_ZH))).toEqual(DARK_ZH);
  });

  it("旧缓存（无 themePrimarySeed 字段）按 null 解析：行为同修复前", () => {
    const legacy = JSON.stringify({
      version: BOOT_PREFERENCES_VERSION,
      theme: "dark",
      themePrimary: "example-theme:indigo",
      language: "zh-CN",
    });
    expect(parseBootPreferences(legacy)).toEqual({
      ...DARK_ZH,
      themePrimarySeed: null,
    });
  });

  it("非法载荷一律返回 null（不抛出）", () => {
    const invalid = [
      null,
      "",
      "not json",
      JSON.stringify([DARK_ZH]),
      JSON.stringify({ ...DARK_ZH, version: BOOT_PREFERENCES_VERSION + 1 }),
      JSON.stringify({ ...DARK_ZH, theme: "system" }),
      JSON.stringify({ ...DARK_ZH, language: "ja-JP" }),
      JSON.stringify({ ...DARK_ZH, themePrimary: 42 }),
      JSON.stringify({ ...DARK_ZH, themePrimarySeed: 42 }),
      JSON.stringify("dark"),
    ];
    for (const raw of invalid) {
      expect(parseBootPreferences(raw)).toBeNull();
    }
  });
});

describe("readBootPreferences / writeBootPreferences", () => {
  it("写入后可原样读回", () => {
    const { storage, raw } = makeStorage();
    writeBootPreferences(DARK_ZH, storage);

    expect(JSON.parse(String(raw(BOOT_PREFERENCES_KEY)))).toEqual({
      version: BOOT_PREFERENCES_VERSION,
      ...DARK_ZH,
    });
    expect(readBootPreferences(storage)).toEqual(DARK_ZH);
  });

  it("storage 不可用 / 抛错时静默降级（读 null、写不抛）", () => {
    expect(readBootPreferences(null)).toBeNull();
    expect(() => {
      writeBootPreferences(DARK_ZH, null);
    }).not.toThrow();

    expect(readBootPreferences(throwingStorage)).toBeNull();
    expect(() => {
      writeBootPreferences(DARK_ZH, throwingStorage);
    }).not.toThrow();
  });

  it("缓存损坏时退回 null（而非抛出）", () => {
    const { storage } = makeStorage({ [BOOT_PREFERENCES_KEY]: "{bad json" });
    expect(readBootPreferences(storage)).toBeNull();
  });
});

describe("hydrateBootPreferences", () => {
  it("有缓存：写 store 偏好 + 初始化 i18n + 标记 <html>", () => {
    const { storage } = makeStorage({
      [BOOT_PREFERENCES_KEY]: payload(DARK_ZH),
    });
    const setPreferences = vi.fn();
    const initI18n = vi.fn();
    const documentElement = { lang: "", dataset: {} as Record<string, string> };

    const applied = hydrateBootPreferences({
      storage,
      setPreferences,
      initI18n,
      documentElement,
    });

    expect(applied).toEqual(DARK_ZH);
    expect(setPreferences).toHaveBeenCalledWith(DARK_ZH);
    expect(initI18n).toHaveBeenCalledWith("zh-CN");
    expect(documentElement.lang).toBe("zh-CN");
    expect(documentElement.dataset.mamepTheme).toBe("dark");
  });

  it("无缓存 / 缓存损坏：应用默认偏好（保证首帧标记确定性）", () => {
    for (const storage of [
      makeStorage().storage,
      makeStorage({ [BOOT_PREFERENCES_KEY]: "{bad json" }).storage,
      null,
    ]) {
      const setPreferences = vi.fn();
      const initI18n = vi.fn();
      const documentElement = {
        lang: "",
        dataset: {} as Record<string, string>,
      };

      expect(
        hydrateBootPreferences({
          storage,
          setPreferences,
          initI18n,
          documentElement,
        }),
      ).toEqual(DEFAULT_BOOT_PREFERENCES);
      expect(setPreferences).toHaveBeenCalledWith(DEFAULT_BOOT_PREFERENCES);
      expect(initI18n).toHaveBeenCalledWith("en-US");
      expect(documentElement.lang).toBe("en-US");
      expect(documentElement.dataset.mamepTheme).toBe("light");
    }
  });

  it("默认写入同时落到 store（含 workspace.preferences.language）", () => {
    const { storage } = makeStorage({
      [BOOT_PREFERENCES_KEY]: payload(DARK_ZH),
    });
    try {
      hydrateBootPreferences({
        storage,
        initI18n: vi.fn(),
        documentElement: null,
      });

      const state = useAppStore.getState();
      expect(state.theme).toBe("dark");
      expect(state.themePrimary).toBe("example-theme:indigo");
      // 主色种子也要落到 store，首帧才能直接着色。
      expect(state.themeColorSeed).toBe("#4f46e5");
      // 关键：`<html lang>` effect 读的是 workspace 偏好，必须同步写入（否则会被默认 en-US 顶回）。
      expect(state.workspace.preferences).toMatchObject({
        theme: "dark",
        language: "zh-CN",
        themePrimary: "example-theme:indigo",
      });
    } finally {
      useAppStore.setState({
        theme: "light",
        themePrimary: null,
        themeColorSeed: null,
      });
      useAppStore.getState().setLanguage("en-US");
    }
  });

  it("无 `<html>`（node / 非浏览器环境）不抛错", () => {
    expect(() =>
      hydrateBootPreferences({
        storage: null,
        setPreferences: vi.fn(),
        initI18n: vi.fn(),
        documentElement: null,
      }),
    ).not.toThrow();
  });
});

describe("installPreferencesCache", () => {
  afterEach(() => {
    useAppStore.setState({
      theme: "light",
      themePrimary: null,
      themeColorSeed: null,
    });
    useAppStore.getState().setLanguage("en-US");
  });

  it("主题 / 主题色 / 主色种子 / 语言变化即写回缓存", () => {
    const { storage, raw } = makeStorage();
    const unsubscribe = installPreferencesCache(storage);
    try {
      useAppStore.getState().setTheme("dark");
      expect(JSON.parse(String(raw(BOOT_PREFERENCES_KEY)))).toMatchObject({
        theme: "dark",
        language: "en-US",
      });

      useAppStore.getState().setThemePrimary("example-theme:indigo");
      expect(JSON.parse(String(raw(BOOT_PREFERENCES_KEY)))).toMatchObject({
        themePrimary: "example-theme:indigo",
      });

      // 插件就绪后 MamepApp 回写解析出的主色种子（供下次刷新首帧直接着色）。
      useAppStore.getState().setThemeColorSeed("#4f46e5");
      expect(JSON.parse(String(raw(BOOT_PREFERENCES_KEY)))).toMatchObject({
        themePrimarySeed: "#4f46e5",
      });

      useAppStore.getState().setLanguage("zh-CN");
      expect(JSON.parse(String(raw(BOOT_PREFERENCES_KEY)))).toMatchObject({
        theme: "dark",
        themePrimarySeed: "#4f46e5",
        language: "zh-CN",
      });
    } finally {
      unsubscribe();
    }
  });

  it("无变化时不写（避免多余写入）", () => {
    const { storage } = makeStorage();
    const setItem = vi.spyOn(storage, "setItem");
    const unsubscribe = installPreferencesCache(storage);
    try {
      // 与当前偏好等价的 setState（字段未变）不产生写入。
      useAppStore.setState({ theme: useAppStore.getState().theme });
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});
