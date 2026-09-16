import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MOBILE_LAYOUT_MEDIA_QUERY, useIsMobileLayout } from "./breakpoints";
import { setMatchMediaMatches } from "../test/match-media";

afterEach(() => {
  setMatchMediaMatches(MOBILE_LAYOUT_MEDIA_QUERY, false);
});

describe("useIsMobileLayout", () => {
  it("默认（媒体查询不匹配）为桌面布局", () => {
    const { result } = renderHook(() => useIsMobileLayout());
    expect(result.current).toBe(false);
  });

  it("媒体查询初始匹配 → 移动布局", () => {
    setMatchMediaMatches(MOBILE_LAYOUT_MEDIA_QUERY, true);
    const { result } = renderHook(() => useIsMobileLayout());
    expect(result.current).toBe(true);
  });

  it("运行中尺寸变化（change 事件）→ 状态跟随", () => {
    const { result } = renderHook(() => useIsMobileLayout());
    expect(result.current).toBe(false);

    act(() => setMatchMediaMatches(MOBILE_LAYOUT_MEDIA_QUERY, true));
    expect(result.current).toBe(true);

    act(() => setMatchMediaMatches(MOBILE_LAYOUT_MEDIA_QUERY, false));
    expect(result.current).toBe(false);
  });

  it("卸载后不再响应变化（监听器已移除）", () => {
    setMatchMediaMatches(MOBILE_LAYOUT_MEDIA_QUERY, true);
    const { result, unmount } = renderHook(() => useIsMobileLayout());
    expect(result.current).toBe(true);
    unmount();

    // 变化后不应抛错（监听器已清理）。
    expect(() =>
      setMatchMediaMatches(MOBILE_LAYOUT_MEDIA_QUERY, false),
    ).not.toThrow();
  });

  it("无 matchMedia 的环境退回桌面布局（SSR 安全）", () => {
    const original = window.matchMedia;
    // @ts-expect-error 故意移除以覆盖降级分支
    delete window.matchMedia;
    try {
      const warn = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const { result } = renderHook(() => useIsMobileLayout());
      expect(result.current).toBe(false);
      warn.mockRestore();
    } finally {
      window.matchMedia = original;
    }
  });
});
