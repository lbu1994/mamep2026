/**
 * VSCode 端骨架 e2e（真实 VSCode + 扩展，生产构建路径）：
 * 1) 激活 → 命令 mamep2026.openMainPanel 打开主面板；
 * 2) Webview 生产 HTML：asWebviewUri 资源 + bridge 注入 + CSP style-src + 不含 dev server；
 * 3) Webview 内 bridge 启动后向上发送 get-color-theme request（HostMessage v1 类型化 RPC
 *    上行，VscodeAppHost 初始化主题的真实路径）——扩展宿主 handleVscodeInvoke 已接
 *    onDidReceiveMessage 并响应（响应/错误路径由 apps/vscode-extension/src/ipc.test.ts 覆盖）。
 * 运行：pnpm test:e2e:vscode（自动先 build:vscode）。
 */
import * as assert from "assert";
import * as vscode from "vscode";

const VIEW_TYPE = "mamep2026.mainPanel";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function run(): Promise<void> {
  // 1. 命令打开主面板。
  await vscode.commands.executeCommand("mamep2026.openMainPanel");
  await sleep(500);

  // 2. dev 探针取面板引用（extensionDevelopmentPath → ExtensionMode.Development）。
  const panel = (await vscode.commands.executeCommand(
    "mamep2026.debug:getPanel",
  )) as vscode.WebviewPanel | undefined;
  assert.ok(
    panel !== undefined,
    "mamep2026.debug:getPanel should return the main panel in development mode",
  );
  assert.strictEqual(panel.viewType, VIEW_TYPE);

  // 3. 生产 HTML 断言：资源已重写为 asWebviewUri（scheme 与 VSCode 版本相关，不断言具体 scheme）
  //    + bridge 注入 + CSP style-src + 无裸相对路径 + 不引用 dev server。
  const html = panel.webview.html;
  assert.ok(
    html.includes("dist/media"),
    "assets should be rewritten to webview resource URIs (asWebviewUri)",
  );
  assert.ok(
    html.includes("vscode-bridge.js"),
    "webview bridge script should be injected before the module script",
  );
  assert.ok(
    html.includes("style-src") && html.includes("'unsafe-inline'"),
    "CSP should allow inline styles (antd CSS-in-JS)",
  );
  assert.ok(
    !html.includes('src="./assets/'),
    "assets should not use bare relative paths",
  );
  assert.ok(
    !html.includes("localhost:5173"),
    "production html should not reference the dev server",
  );

  // 4. Webview bridge 启动后向上发送类型化 RPC request（VscodeAppHost 初始化主题）。
  //    缓冲式监听：面板创建后立即挂接，避免漏掉早期到达的消息。
  const rpcSeen = await new Promise<boolean>((resolve) => {
    const seen = new Set<string>();
    const timeout = setTimeout(() => resolve(seen.size > 0), 30_000);
    const sub = panel.webview.onDidReceiveMessage((raw: unknown) => {
      const msg = raw as { type?: string; kind?: string };
      if (msg.type === "request" && typeof msg.kind === "string") {
        seen.add(msg.kind);
      }
      if (msg.kind === "get-color-theme" || msg.kind === "get-capabilities") {
        clearTimeout(timeout);
        sub.dispose();
        resolve(true);
      }
    });
  });
  assert.ok(
    rpcSeen,
    "webview should send a typed RPC request (get-color-theme / get-capabilities)",
  );
}
