import type { ThemeConfig } from "antd";

/**
 * ThemeConfig 合并：token 浅合并 + components 逐组件浅合并，override 优先；
 * algorithm 与 cssVar 取 base（VSCode 令牌覆盖不改算法）。
 *
 * antd 的 components 是组件名 → 组件 token 的映射类型（无索引签名），
 * 这里按 Record<string, object> 边界合并后一次性收窄（不触碰任何内部 API）。
 */
export function mergeThemeConfig(
  base: ThemeConfig,
  overrides: ThemeConfig,
): ThemeConfig {
  const result: ThemeConfig = { ...base, ...overrides };
  const token = { ...(base.token ?? {}), ...(overrides.token ?? {}) };
  if (Object.keys(token).length > 0) result.token = token;
  const components = mergeComponents(base.components, overrides.components);
  if (components !== undefined) result.components = components;
  return result;
}

function mergeComponents(
  base: ThemeConfig["components"],
  overrides: ThemeConfig["components"],
): ThemeConfig["components"] {
  if (overrides === undefined) return base;
  if (base === undefined) return overrides;
  const result: Record<string, object> = {
    ...(base as Record<string, object>),
  };
  for (const [name, overrideTokens] of Object.entries(overrides)) {
    if (overrideTokens === undefined) continue;
    const baseTokens = (base as Record<string, object>)[name] ?? {};
    result[name] = { ...baseTokens, ...(overrideTokens as object) };
  }
  return result as ThemeConfig["components"];
}
