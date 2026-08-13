import * as vscode from "vscode";

/**
 * 开发模式页面地址：与浏览器、Electron 共享同一个 Vite dev server。
 * 可通过环境变量 MAMEP_DEV_URL 覆盖（如本地端口冲突时）。
 */
const DEV_URL = process.env.MAMEP_DEV_URL ?? "http://localhost:5173";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("mamep2026.openMainPanel", () => {
      const panel = vscode.window.createWebviewPanel(
        "mamep2026.mainPanel",
        "Mamep2026",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      );

      panel.webview.html = getHtml();
    }),
  );
}

export function deactivate(): void {
  // MVP 阶段无需要释放的资源。
}

function getHtml(): string {
  // MVP：三端加载同一页面。
  // 开发模式：iframe 指向 Vite dev server（浏览器/Electron 同款页面）。
  // 生产模式：后续替换为打包进扩展的本地静态资源（asWebviewUri 加载）。
  //
  // 注意：CSP 的 default-src 'none' 会作为 style-src 的回退源，
  // 若不显式允许内联样式，iframe 的铺满样式会被阻止，
  // 导致 iframe 退回 300x150 默认尺寸。因此必须声明 style-src。
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `frame-src ${DEV_URL} http://localhost:*`,
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
  <iframe src="${DEV_URL}"></iframe>
</body>
</html>`;
}
