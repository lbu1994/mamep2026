import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// antd 组件在 jsdom 下依赖的部分浏览器 API，提供最小桩。
if (typeof window !== "undefined") {
  if (window.matchMedia === undefined) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (window.ResizeObserver === undefined) {
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }
}

afterEach(() => cleanup());
