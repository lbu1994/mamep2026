import { describe, expect, it } from "vitest";
import { buildWebCsp } from "./csp";

/**
 * 生产构建 CSP 回归保护（2026-09-10，ADR-050）。
 * 重点是 `worker-src ... blob:`：缺失时插件隔离运行时（Blob URL Worker）会被打包产物 CSP 拦截。
 */
describe("buildWebCsp (docs/TECH_DESIGN.md §22.1)", () => {
  it("放行 Blob Worker（插件隔离运行时；缺失则回退 script-src 'self' 并拦截 blob:）", () => {
    const workerSrc = buildWebCsp()
      .split("; ")
      .find((directive) => directive.startsWith("worker-src "));

    expect(workerSrc).toBe("worker-src 'self' blob:");
  });

  it("保留既有基线指令", () => {
    const csp = buildWebCsp();

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    // antd CSS-in-JS 需要内联样式。
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self'");
    // 不放开脚本源（除 Blob Worker 外仍为同源）。
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
