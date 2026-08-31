/**
 * theme 贡献点消费方（docs/插件功能设计.md §3.2/§4.4，ADR-039）。
 * 插件贡献主题色（纯数据：colorPrimary/colorLink 的 light/dark 两态）→ 收集为 antd
 * ThemeConfig.token 覆盖 → MamepApp 经 mergeThemeConfig 并入装配链（插件 → 用户设置 →
 * 默认；用户设置属 Phase D）。Phase A 即可全功能（无执行依赖）。
 */
import type { ThemeConfig } from "antd";
import type { Contribution } from "@mamep2026/plugin-api";

export interface ThemeContribution {
  colorPrimary?: { light: string; dark: string };
  colorLink?: { light: string; dark: string };
}

/** 收集插件主题贡献为 ThemeConfig.token 覆盖（无贡献返回 null）。 */
export function collectThemeConfig(
  contributions: readonly Contribution<ThemeContribution>[],
  dark: boolean,
): ThemeConfig | null {
  const mode = dark ? "dark" : "light";
  let token: ThemeConfig["token"] | undefined;
  for (const contribution of contributions) {
    const payload = contribution.payload;
    const colorPrimary = payload.colorPrimary?.[mode];
    const colorLink = payload.colorLink?.[mode];
    if (colorPrimary === undefined && colorLink === undefined) continue;
    token = {
      ...token,
      ...(colorPrimary !== undefined ? { colorPrimary } : {}),
      ...(colorLink !== undefined ? { colorLink } : {}),
    };
  }
  return token === undefined ? null : { token };
}
