import { describe, expect, it } from "vitest";
import {
  collectThemeConfig,
  type ThemeContribution,
} from "./theme-contributions";
import type { Contribution } from "@mamep2026/plugin-api";

function contribution(
  pluginId: string,
  payload: ThemeContribution,
): Contribution<ThemeContribution> {
  return { pluginId, payload };
}

describe("collectThemeConfig（ADR-039：theme 贡献收集）", () => {
  it("无贡献 → null", () => {
    expect(collectThemeConfig([], true)).toBeNull();
  });

  it("收集浅色主色 → token.colorPrimary（按 dark 模式取对应值）", () => {
    const config = collectThemeConfig(
      [
        contribution("p1", {
          colorPrimary: { light: "#111111", dark: "#222222" },
        }),
      ],
      false,
    );
    expect(config).toEqual({ token: { colorPrimary: "#111111" } });
    const darkConfig = collectThemeConfig(
      [
        contribution("p1", {
          colorPrimary: { light: "#111111", dark: "#222222" },
        }),
      ],
      true,
    );
    expect(darkConfig).toEqual({ token: { colorPrimary: "#222222" } });
  });

  it("多插件贡献浅合并，后者优先", () => {
    const config = collectThemeConfig(
      [
        contribution("p1", { colorPrimary: { light: "#111111", dark: "#111" } }),
        contribution("p2", {
          colorLink: { light: "#333333", dark: "#333" },
          colorPrimary: { light: "#222222", dark: "#222" },
        }),
      ],
      false,
    );
    expect(config).toEqual({
      token: { colorPrimary: "#222222", colorLink: "#333333" },
    });
  });

  it("仅 colorLink 贡献不产生 colorPrimary", () => {
    const config = collectThemeConfig(
      [contribution("p1", { colorLink: { light: "#999", dark: "#888" } })],
      false,
    );
    expect(config).toEqual({ token: { colorLink: "#999" } });
  });
});
