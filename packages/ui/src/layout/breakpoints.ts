/**
 * 响应式断点（ADR-050 Phase 3）。
 *
 * 单一事实源：`< 1024px` 视为**移动布局**（侧栏→Drawer、底部面板→底部抽屉、工具栏溢出）。
 * 收紧了 Phase 3 之前的 1100px（当时只用于 Header 次要按钮收纳），避免出现
 * 「1024~1100 区间两套阈值打架」的中间态。
 *
 * CSS 侧媒体查询在 `apps/web/src/index.css` 中手写同一数值（媒体查询不能引用 JS 常量），
 * 注释已标注同源；行为由 `mobile-layout` e2e 守住。
 */
import { useEffect, useState } from "react";

/** 移动布局的最大宽度（含）。 */
export const MOBILE_LAYOUT_MAX_WIDTH = 1023;

/** 与 `MOBILE_LAYOUT_MAX_WIDTH` 同源的媒体查询字符串。 */
export const MOBILE_LAYOUT_MEDIA_QUERY = `(max-width: ${MOBILE_LAYOUT_MAX_WIDTH}px)`;

function currentMatches(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia(MOBILE_LAYOUT_MEDIA_QUERY).matches;
}

/**
 * 是否处于移动布局。
 *
 * 只订阅一次 `change`，不做逐帧测量（避免布局抖动与重渲染）。
 * SSR/jsdom 无 `matchMedia` 时恒为 `false`（桌面布局）。
 */
export function useIsMobileLayout(): boolean {
  const [isMobileLayout, setIsMobileLayout] = useState<boolean>(currentMatches);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(MOBILE_LAYOUT_MEDIA_QUERY);
    const update = (): void => setIsMobileLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isMobileLayout;
}
