/**
 * 主题构建（2026-08-25 迁入 @mamep2026/ui-theme）：ui-theme 承载完整主题体系
 * （base + VSCode 完整令牌映射 buildVscodeTheme，ADR-027）。本文件为兼容 re-export：
 * MamepApp 仍经 ./theme 引入 buildTheme；依赖方向 ui → ui-theme（无环）。
 */
export {
  buildTheme,
  UI_FONT_STACK,
  MONO_FONT_STACK,
} from "@mamep2026/ui-theme";
