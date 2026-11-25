import { describe, expect, it } from "vitest";

import { isKnownVSCodeWebviewShellPageError } from "../real/known-upstream-errors";

function pageError(message: string, stack: string): Error {
  const error = new Error(message);
  error.stack = `${message}\n    at ${stack}`;
  return error;
}

describe("isKnownVSCodeWebviewShellPageError", () => {
  it("识别 VSCode Webview 壳层 body 尚未就绪的 classList 启动竞态", () => {
    const error = pageError(
      "Cannot read properties of null (reading 'classList')",
      "vscode-webview://example/index.html?...:66:122",
    );

    expect(isKnownVSCodeWebviewShellPageError(error)).toBe(true);
  });

  it("相同消息但栈位置不同时不忽略，避免掩盖应用自身错误", () => {
    const error = pageError(
      "Cannot read properties of null (reading 'classList')",
      "vscode-webview://example/assets/app.js:1:1",
    );

    expect(isKnownVSCodeWebviewShellPageError(error)).toBe(false);
  });

  it("相同栈位置但消息不同时不忽略，避免扩大豁免范围", () => {
    const error = pageError(
      "Unexpected application failure",
      "vscode-webview://example/index.html?...:66:122",
    );

    expect(isKnownVSCodeWebviewShellPageError(error)).toBe(false);
  });
});
