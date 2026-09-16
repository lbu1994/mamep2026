import { describe, expect, it } from "vitest";
import {
  buildThemeColorOptions,
  DEFAULT_THEME_COLOR_ID,
  deriveAppliedPrimary,
  findThemeColorOption,
  themeColorTitle,
  themeConfigForColorOption,
  themeConfigForColorSeed,
  resolveThemeColorSeed,
  type ThemeContribution,
} from "./theme-contributions";
import type { Contribution } from "@mamep2026/plugin-api";

function contribution(
  pluginId: string,
  payload: ThemeContribution,
): Contribution<ThemeContribution> {
  return { pluginId, payload };
}

describe("theme 贡献消费方（ADR-047：注册可选主题色）", () => {
  it("无贡献 → 空选项", () => {
    expect(buildThemeColorOptions([])).toEqual([]);
  });

  it("多色注册：扁平化为 `<pluginId>:<colorId>`，保留顺序；仅需单一明亮主色", () => {
    const options = buildThemeColorOptions([
      contribution("p1", {
        colors: [
          {
            id: "indigo",
            titleKey: "plugins.p1Indigo",
            colorPrimary: "#4f46e5",
          },
          {
            id: "teal",
            titleKey: "plugins.p1Teal",
            colorPrimary: "#0d9488",
          },
        ],
      }),
      contribution("p2", {
        colors: [
          {
            id: "amber",
            titleKey: "plugins.p2Amber",
            title: { "en-US": "Amber", "zh-CN": "琥珀" },
            colorPrimary: "#d97706",
          },
        ],
      }),
    ]);
    expect(options).toEqual([
      {
        id: "p1:indigo",
        titleKey: "plugins.p1Indigo",
        colorPrimary: "#4f46e5",
      },
      {
        id: "p1:teal",
        titleKey: "plugins.p1Teal",
        colorPrimary: "#0d9488",
      },
      {
        id: "p2:amber",
        titleKey: "plugins.p2Amber",
        title: { "en-US": "Amber", "zh-CN": "琥珀" },
        colorPrimary: "#d97706",
      },
    ]);
  });

  it("findThemeColorOption：按完整预设 ID 查找；未找到/插件禁用后返回 null", () => {
    const contributions = [
      contribution("p1", {
        colors: [
          {
            id: "indigo",
            titleKey: "plugins.p1Indigo",
            colorPrimary: "#4f46e5",
          },
        ],
      }),
    ];
    expect(findThemeColorOption(contributions, "p1:indigo")?.id).toBe(
      "p1:indigo",
    );
    expect(findThemeColorOption(contributions, "p1:nope")).toBeNull();
    expect(findThemeColorOption([], "p1:indigo")).toBeNull();
  });

  it("themeConfigForColorOption：只喂单一主色，链接色统一跟随主色（不区分 dark）", () => {
    const option = {
      id: "p1:indigo",
      titleKey: "plugins.p1Indigo",
      colorPrimary: "#4f46e5",
    };
    expect(themeConfigForColorOption(option)).toEqual({
      token: { colorPrimary: "#4f46e5", colorLink: "#4f46e5" },
    });
    // 色种子版本（插件未就绪时的过渡着色）与预设版本同形。
    expect(themeConfigForColorSeed("#4f46e5")).toEqual(
      themeConfigForColorOption(option),
    );
  });

  it("resolveThemeColorSeed：就绪前用缓存种子，就绪后 / 未选预设一律回退默认蓝（2026-09-16）", () => {
    const cases: Array<{
      name: string;
      resolvedSeed: string | null;
      themePrimary: string | null;
      pluginsReady: boolean;
      cachedSeed: string | null;
      expected: string | null;
    }> = [
      {
        name: "已解析到预设（插件已就绪）→ 用预设色",
        resolvedSeed: "#4f46e5",
        themePrimary: "p1:indigo",
        pluginsReady: true,
        cachedSeed: "#111111",
        expected: "#4f46e5",
      },
      {
        name: "选了预设但插件尚未就绪 → 用启动缓存种子（首帧不闪默认蓝）",
        resolvedSeed: null,
        themePrimary: "p1:indigo",
        pluginsReady: false,
        cachedSeed: "#4f46e5",
        expected: "#4f46e5",
      },
      {
        name: "选了预设、插件就绪却解析不到（禁用/卸载）→ 回退默认蓝",
        resolvedSeed: null,
        themePrimary: "p1:indigo",
        pluginsReady: true,
        cachedSeed: "#4f46e5",
        expected: null,
      },
      {
        name: "未选预设（默认蓝）→ 即使有缓存种子也不着色",
        resolvedSeed: null,
        themePrimary: null,
        pluginsReady: false,
        cachedSeed: "#4f46e5",
        expected: null,
      },
      {
        name: "选了预设、插件未就绪但无缓存种子 → 回退默认蓝（不劣化）",
        resolvedSeed: null,
        themePrimary: "p1:indigo",
        pluginsReady: false,
        cachedSeed: null,
        expected: null,
      },
    ];
    for (const testCase of cases) {
      expect(
        resolveThemeColorSeed(testCase.resolvedSeed, {
          themePrimary: testCase.themePrimary,
          pluginsReady: testCase.pluginsReady,
          cachedSeed: testCase.cachedSeed,
        }),
        testCase.name,
      ).toBe(testCase.expected);
    }
  });

  it("deriveAppliedPrimary：浅色返回种子，暗色返回 antd 算法派生值（只读，不喂回 ConfigProvider）", () => {
    // 浅色：antd 直接用种子作为 colorPrimary。
    expect(deriveAppliedPrimary("#4f46e5", false)).toBe("#4f46e5");
    // 暗色：antd darkAlgorithm 从种子派生，结果不等于浅色种子，且为标准 hex。
    const dark = deriveAppliedPrimary("#4f46e5", true);
    expect(dark).not.toBe("#4f46e5");
    expect(dark).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("DEFAULT_THEME_COLOR_ID 为内置默认蓝哨兵（无冒号，不与插件 ID 冲突）", () => {
    expect(DEFAULT_THEME_COLOR_ID).toBe("default");
  });

  it("themeColorTitle：插件 title 优先 → 缺失语言回退英文 → 再回退 t(titleKey)（方案 A）", () => {
    const withTitle = {
      id: "p1:indigo",
      titleKey: "plugins.p1Indigo",
      title: { "en-US": "Indigo", "zh-CN": "靛蓝" },
      colorPrimary: "#4f46e5",
    };
    const translate = (k: string) => `[${k}]`;

    // 当前语言命中插件 title。
    expect(themeColorTitle(withTitle, "zh-CN", translate)).toBe("靛蓝");
    expect(themeColorTitle(withTitle, "en-US", translate)).toBe("Indigo");
    // 未提供语言 → 回退英文。
    expect(themeColorTitle(withTitle, "ja-JP", translate)).toBe("Indigo");

    // 插件未提供 title → 回退应用 i18n titleKey。
    const noTitle = {
      id: "p2:amber",
      titleKey: "plugins.p2Amber",
      colorPrimary: "#d97706",
    };
    expect(themeColorTitle(noTitle, "zh-CN", translate)).toBe(
      "[plugins.p2Amber]",
    );
  });
});
