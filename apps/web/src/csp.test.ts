import { describe, expect, it } from "vitest";
import { buildWebCsp } from "./csp";

/**
 * 生产构建 CSP 回归保护（2026-09-10，ADR-050；2026-09-12 ADR-055 补齐 script-src）。
 * 重点是两条 blob: 放行：`worker-src ... blob:`（创建 Blob Worker）与 `script-src ... blob:`
 * （Worker 内 / 文档内的插件 entry 动态 import）——任一缺失都会在打包产物中拦截可执行插件。
 */
describe("buildWebCsp (docs/TECH_DESIGN.md §22.1)", () => {
  it("放行 Blob Worker（插件隔离运行时；缺失则回退 script-src 'self' 并拦截 blob:）", () => {
    const workerSrc = buildWebCsp()
      .split("; ")
      .find((directive) => directive.startsWith("worker-src "));

    expect(workerSrc).toBe("worker-src 'self' blob:");
  });

  it("放行 blob: 脚本（插件 entry 动态 import；缺失则 Worker 内 import 被拦截）", () => {
    const scriptSrc = buildWebCsp()
      .split("; ")
      .find((directive) => directive.startsWith("script-src "));

    expect(scriptSrc).toBe("script-src 'self' blob:");
  });

  it("保留既有基线指令", () => {
    const csp = buildWebCsp();

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' blob:");
    // antd CSS-in-JS 需要内联样式。
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self'");
    // 不放开内联脚本（除 Blob 插件 entry 外仍为同源）。
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
