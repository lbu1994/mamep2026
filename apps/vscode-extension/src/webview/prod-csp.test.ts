import { describe, expect, it } from "vitest";
import { buildWebviewCsp } from "./prod-csp";

/**
 * VSCode 生产 Webview CSP 回归保护（2026-09-10，ADR-050）。
 * 重点是 `worker-src <cspSource> 'self' blob:`：缺失时插件隔离运行时（Blob URL Worker）会被拦截。
 */
describe("buildWebviewCsp (docs/TECH_DESIGN.md §22.2)", () => {
  const CSP_SOURCE = "vscode-webview://abc";

  it("放行 Blob Worker（插件隔离运行时）", () => {
    const workerSrc = buildWebviewCsp(CSP_SOURCE)
      .split("; ")
      .find((directive) => directive.startsWith("worker-src "));

    expect(workerSrc).toBe(`worker-src ${CSP_SOURCE} 'self' blob:`);
  });

  it("资源源使用 webview.cspSource 并保留基线指令", () => {
    const csp = buildWebviewCsp(CSP_SOURCE);

    expect(csp).toContain(`default-src ${CSP_SOURCE} 'self'`);
    expect(csp).toContain(`script-src ${CSP_SOURCE} 'self'`);
    expect(csp).toContain(`style-src ${CSP_SOURCE} 'self' 'unsafe-inline'`);
    // 不放开脚本源。
    expect(csp).not.toContain("script-src 'unsafe-inline'");
  });
});
