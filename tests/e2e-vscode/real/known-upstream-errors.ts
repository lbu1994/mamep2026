const VSCODE_WEBVIEW_SHELL_BODY_RACE_MESSAGE =
  "Cannot read properties of null (reading 'classList')";

const VSCODE_WEBVIEW_SHELL_BODY_RACE_STACK =
  /vscode-webview:\/\/[^\n]+\/index.html\?[^\n]*:66:122(?:\n|$)/;

/**
 * 识别 VSCode Webview 壳层的启动竞态，而不是 Mamep 共享 UI 的错误。
 *
 * VSCode 1.147/1.148 的 webview pre/index.html:66:122 会在 iframe 文档仍无
 * body 时访问 target.contentDocument.body.classList。这里必须同时匹配精确消息
 * 与精确栈位置，避免把应用自身的 classList 空引用误放行。
 */
export function isKnownVSCodeWebviewShellPageError(error: Error): boolean {
  if (error.message !== VSCODE_WEBVIEW_SHELL_BODY_RACE_MESSAGE) return false;
  return VSCODE_WEBVIEW_SHELL_BODY_RACE_STACK.test(error.stack ?? "");
}
