import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { installMatchMediaStub, resetMatchMediaStub } from "./match-media";

// antd 组件在 jsdom 下依赖的部分浏览器 API，提供最小桩。
if (typeof window !== "undefined") {
  // 可配置 matchMedia 桩（断点）：默认全部不匹配，与既有行为一致。
  installMatchMediaStub();
  if (window.ResizeObserver === undefined) {
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }
}

afterEach(() => {
  cleanup();
  resetMatchMediaStub();
});
