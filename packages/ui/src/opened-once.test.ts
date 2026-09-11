import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useOpenedOnce } from "./opened-once";

describe("useOpenedOnce（懒加载组件的挂载门控）", () => {
  it("初始未打开 → false（首屏不挂载，chunk 不下载）", () => {
    const { result } = renderHook(({ open }) => useOpenedOnce(open), {
      initialProps: { open: false },
    });
    expect(result.current).toBe(false);
  });

  it("初始已打开 → true（直接挂载）", () => {
    const { result } = renderHook(({ open }) => useOpenedOnce(open), {
      initialProps: { open: true },
    });
    expect(result.current).toBe(true);
  });

  it("打开后保持 true（关闭动画需要组件常驻）", () => {
    const { result, rerender } = renderHook(({ open }) => useOpenedOnce(open), {
      initialProps: { open: false },
    });
    expect(result.current).toBe(false);

    rerender({ open: true });
    expect(result.current).toBe(true);

    rerender({ open: false });
    expect(result.current).toBe(true);

    // 再次打开仍为 true（不回退）。
    rerender({ open: true });
    expect(result.current).toBe(true);
  });

  it("重渲染（open 不变）不改变结果", () => {
    const { result, rerender } = renderHook(({ open }) => useOpenedOnce(open), {
      initialProps: { open: false },
    });
    act(() => {
      rerender({ open: false });
    });
    expect(result.current).toBe(false);
  });
});
