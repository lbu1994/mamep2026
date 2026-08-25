# @mamep2026/ui-theme

平台主题适配层（ADR-027）。承载 Mamep2026 的完整 antd 主题体系：

- `base.ts` — 应用级 base 主题（`buildTheme(dark)`）：品牌蓝、状态语义色、字号/控件高/圆角、
  紧凑间距、双字体角色、灰阶 AA 校准。**三端共用**（浏览器/Electron 直接消费；VSCode 作为
  完整映射的基底）。
- `map.ts` / `merge.ts` / `build.ts` — VSCode Theme Color → antd token 完整映射：
  `buildVscodeTheme(colors, dark)` = `mergeThemeConfig(buildTheme(dark), mapVscodeTheme(colors, dark))`。
  决策（2026-08-25）：中性色/表面/边框/输入态/选择态跟随 VSCode 主题；品牌蓝与状态语义色、
  字号/间距/圆角保留产品值；文字灰阶由 `editor-foreground` 推导 alpha 并经
  `ensureContrast` 保证 WCAG 2.2 AA。
- `theme-colors.ts` — `--vscode-*` CSS 变量读取（`readVscodeCssVars`）与变量清单
  `VSCODE_CSS_VAR_NAMES`（dev 中继脚本与 ui-theme 保持一致）。
- `contrast.ts` — 颜色解析/混合/对比度工具（`scripts/check-contrast.mjs` 同思路）。

依赖方向：`ui-theme → antd`（唯一运行时依赖），`packages/ui → ui-theme`（base 反向
re-export，见 `packages/ui/src/theme.ts`），`apps/* → ui-theme`。无环。
