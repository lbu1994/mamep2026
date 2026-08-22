/**
 * Webview HTML 生成（纯函数，不依赖 vscode 模块，可单测；docs/TECH_DESIGN.md §22.2）。
 *
 * dev 模式（MAMEP_DEV_URL）：Webview 主 frame 以 <iframe src="${devUrl}/?mamepVscode=1">
 * 加载 Vite dev server 的 index.html（渲染/HMR 由 Vite 处理，与浏览器/Electron 同页面）。
 * window.mamepHost 的建立方式（2026-08-23 修复，VSCode Webview 官方消息机制，见
 * code.visualstudio.com/api/extension-guides/webview）：
 *   - iframe 内应用（apps/web/src/vscode-dev-bridge.ts）把 window.parent.postMessage 封装
 *     成 VsCodeApi，复用 platform-api 的 createVscodeBridge 设置 window.mamepHost
 *     （HostMessage v1 类型化 RPC）→ App.tsx 装配 VscodeAppHost，串口枚举走
 *     serial-enumerate RPC（Extension Host 真实串口列表，antd Select 下拉）；
 *   - 本主 frame 中继脚本转发：iframe → acquireVsCodeApi().postMessage → 扩展宿主；
 *     宿主 response/event（HostMessage Envelope）→ iframe.contentWindow.postMessage。
 * 这修复了「dev 模式 iframe 无桥 → 渲染进程落入浏览器 Web Serial 路径 →
 * navigator.serial.requestPort() 被 Webview 权限策略拒绝」的问题。
 */
export interface DevHtmlOptions {
  /** Vite dev server 地址（如 http://localhost:5173），尾斜杠可带可不带。 */
  devUrl: string;
}

export function getDevHtml({ devUrl }: DevHtmlOptions): string {
  const devOrigin = devUrl.replace(/\/+$/, "");
  // 主 frame 只承载 iframe + 内联中继脚本（acquireVsCodeApi 仅在 Webview 主 frame 可用）；
  // 应用在 iframe 内（Vite index.html 自带 CSP 场景），主 frame 无需放行 dev server 脚本源。
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `frame-src ${devOrigin} http://localhost:*`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <style>
    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
    }
    iframe {
      display: block;
      width: 100%;
      height: 100%;
      border: none;
    }
  </style>
</head>
<body>
  <iframe id="app" src="${devOrigin}/?mamepVscode=1"></iframe>
  <script>
    (function () {
      var vscode = acquireVsCodeApi();
      var iframe = document.getElementById("app");
      /** HostMessage v1 Envelope 判定（请求/响应/事件都带 protocolVersion + type）。 */
      function isHostEnvelope(data) {
        return (
          data !== null &&
          typeof data === "object" &&
          typeof data.protocolVersion === "number" &&
          typeof data.type === "string"
        );
      }
      window.addEventListener("message", function (e) {
        // iframe → 扩展宿主。
        if (e.source === iframe.contentWindow) {
          vscode.postMessage(e.data);
          return;
        }
        // 宿主 → iframe（response/error/event Envelope）。
        if (isHostEnvelope(e.data)) {
          iframe.contentWindow.postMessage(e.data, "*");
        }
      });
    })();
  </script>
</body>
</html>`;
}
