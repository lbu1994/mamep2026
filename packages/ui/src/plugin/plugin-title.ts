/**
 * 插件自带标题解析（i18n 方案 A：2026-09-03 theme 引入，2026-09-12 抽为通用）。
 * 插件可在贡献 payload 中给出 `title`（`en-US` 必填 / `zh-CN` 可选）自带翻译，
 * 使**第三方插件无需依赖应用内置 i18n 键**即可显示本地化文案。
 * 解析顺序：当前语言 → 英文 → 应用 i18n `titleKey` → `titleKey` 原文。
 * 消费方：theme（Settings 主题色选择器，`themeColorTitle` 委托本函数）、panels（底部面板插件面板标题）。
 */

/** 插件自带翻译的显示名（与 plugin-api `LOCALIZED_TITLE_SCHEMA` 结构一致）。 */
export interface PluginLocalizedTitle {
  "en-US": string;
  "zh-CN"?: string;
}

/** 解析插件提供的标题：插件 `title`（当前语言 → 英文）→ `t(titleKey)` → `titleKey`。 */
export function pluginLocalizedTitle(
  title: PluginLocalizedTitle | undefined,
  titleKey: string,
  locale: string,
  t: (key: string) => string,
): string {
  const localized =
    locale === "zh-CN"
      ? title?.["zh-CN"]
      : locale === "en-US"
        ? title?.["en-US"]
        : undefined;
  return localized ?? title?.["en-US"] ?? t(titleKey) ?? titleKey;
}
