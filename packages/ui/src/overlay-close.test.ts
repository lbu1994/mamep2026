import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  clearOverlayCloseStack,
  closeTopOverlay,
  overlayCloseStackSize,
  pushOverlayClose,
  removeOverlayClose,
  useOverlayClose,
} from "./overlay-close";

afterEach(() => clearOverlayCloseStack());

describe("覆盖层关闭栈", () => {
  it("空栈时 closeTopOverlay 返回 false（调用方据此最小化应用）", () => {
    expect(overlayCloseStackSize()).toBe(0);
    expect(closeTopOverlay()).toBe(false);
  });

  it("关闭最上层（后进先出）", () => {
    const calls: string[] = [];
    pushOverlayClose(() => {
      calls.push("bottom");
    });
    pushOverlayClose(() => {
      calls.push("top");
    });

    expect(closeTopOverlay()).toBe(true);
    expect(calls).toEqual(["top"]);
    expect(overlayCloseStackSize()).toBe(1);
  });

  it("注销不存在/重复注销不报错", () => {
    const handler = vi.fn();
    pushOverlayClose(handler);
    removeOverlayClose(handler);
    removeOverlayClose(handler);
    expect(overlayCloseStackSize()).toBe(0);
  });

  it("中间层被注销后仍保持相对顺序", () => {
    const calls: string[] = [];
    const first = (): void => {
      calls.push("first");
    };
    const second = (): void => {
      calls.push("second");
    };
    pushOverlayClose(first);
    pushOverlayClose(second);
    removeOverlayClose(first);

    closeTopOverlay();
    expect(calls).toEqual(["second"]);
  });
});

describe("useOverlayClose", () => {
  it("open=true 时注册，关闭/卸载后注销", () => {
    const onClose = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ open }: { open: boolean }) => useOverlayClose(open, onClose),
      { initialProps: { open: true } },
    );
    expect(overlayCloseStackSize()).toBe(1);

    rerender({ open: false });
    expect(overlayCloseStackSize()).toBe(0);

    rerender({ open: true });
    expect(overlayCloseStackSize()).toBe(1);
    unmount();
    expect(overlayCloseStackSize()).toBe(0);
  });

  it("每次渲染传新函数时调用到最新实现（且不重复入栈）", () => {
    const calls: string[] = [];
    const { rerender } = renderHook(
      ({ label }: { label: string }) =>
        useOverlayClose(true, () => {
          calls.push(label);
        }),
      { initialProps: { label: "old" } },
    );
    rerender({ label: "new" });

    expect(overlayCloseStackSize()).toBe(1);
    closeTopOverlay();
    expect(calls).toEqual(["new"]);
  });
});
