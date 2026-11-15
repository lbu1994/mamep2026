// @vitest-environment node
/**
 * Webview dev HTML 生成单测（webview/html.ts 纯函数）。
 * 覆盖要点：dev 模式主 frame 以 iframe 加载 Vite dev server（渲染正常），
 * 主 frame 中继脚本在 iframe ↔ 扩展宿主之间转发 HostMessage Envelope；iframe 内应用
 * （apps/web/src/vscode-dev-bridge.ts）用 postMessage 桥建立 window.mamepHost →
 * VscodeAppHost → serial-enumerate RPC（避免浏览器 Web Serial 权限策略报错）。
 */
import { describe, expect, it } from "vitest";
import { getDevHtml } from "./html";

const DEV_URL = "http://localhost:5173";

describe("getDevHtml（dev 模式 iframe + 主 frame 中继）", () => {
  it("主 frame 用 iframe 加载 dev server（带 mamepVscode 标记）", () => {
    const html = getDevHtml({ devUrl: DEV_URL });
    expect(html).toContain(
      `<iframe id="app" src="${DEV_URL}/?mamepVscode=1"></iframe>`,
    );
  });

  it("主 frame 中继：acquireVsCodeApi + iframe ↔ 宿主双向转发", () => {
    const html = getDevHtml({ devUrl: DEV_URL });
    expect(html).toContain("acquireVsCodeApi()");
    expect(html).toContain("vscode.postMessage(e.data)");
    expect(html).toContain("iframe.contentWindow.postMessage(e.data");
    expect(html).toContain("protocolVersion");
  });

  it("CSP：frame-src 放行 dev server，script/style 允许内联（中继脚本）", () => {
    const html = getDevHtml({ devUrl: DEV_URL });
    const csp = /content="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(csp).toContain(`frame-src ${DEV_URL} http://localhost:*`);
    expect(csp).toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("style-src 'unsafe-inline'");
  });

  it("dev 主 frame 不再加载 vscode-bridge.js（桥在 iframe 内建立）", () => {
    const html = getDevHtml({ devUrl: DEV_URL });
    expect(html).not.toContain("vscode-bridge.js");
    expect(html).not.toContain("/src/main.tsx");
  });

  it("devUrl 带尾斜杠时归一化", () => {
    const html = getDevHtml({ devUrl: "http://localhost:5173/" });
    expect(html).toContain('src="http://localhost:5173/?mamepVscode=1"');
    expect(html).not.toContain("http://localhost:5173//");
  });

  it("主题颜色中继：内置 --vscode-* 变量清单并随消息下发 iframe", () => {
    const html = getDevHtml({ devUrl: DEV_URL });
    // 与 ui-theme VSCODE_CSS_VAR_NAMES 同源的核心变量必须在脚本内。
    expect(html).toContain('"--vscode-editor-background"');
    expect(html).toContain('"--vscode-editor-foreground"');
    expect(html).toContain('"--vscode-focusBorder"');
    // 中继消息为非 HostMessage Envelope（source/type 自定义），避免被转发回宿主。
    expect(html).toContain('source: "mamep-theme-relay"');
    expect(html).toContain('type: "theme-colors"');
    expect(html).toContain("getComputedStyle(document.documentElement)");
    // 初始下发 + iframe 请求响应 + color-theme-changed 转发时顺带重下发。
    expect(html).toContain("relayThemeColors();");
    expect(html).toContain('e.data.type === "theme-colors-request"');
    expect(html).toContain('e.data.kind === "color-theme-changed"');
  });

  it("主题颜色中继请求不转发回宿主（在 vscode.postMessage 之前拦截）", () => {
    const html = getDevHtml({ devUrl: DEV_URL });
    // 请求分支的判定出现在 vscode.postMessage 之前（先 return，不触碰宿主）。
    const idxReq = html.indexOf('e.data.type === "theme-colors-request"');
    const idxPost = html.indexOf("vscode.postMessage(e.data)");
    const idxReturn = html.indexOf("return;", idxReq);
    expect(idxReq).toBeGreaterThan(-1);
    expect(idxPost).toBeGreaterThan(idxReq);
    expect(idxReturn).toBeGreaterThan(idxReq);
    expect(idxReturn).toBeLessThan(idxPost);
  });
});
