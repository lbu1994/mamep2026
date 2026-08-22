/**
 * VSCode 扩展宿主 RPC 核心单测（docs/AGENTS.md §23：未知 kind 拒绝、输入校验、探针禁用）。
 * 纯函数 + 依赖注入，不依赖 vscode 运行时。
 */
import { describe, expect, it, vi } from "vitest";
import {
  HOST_MESSAGE_PROTOCOL_VERSION,
  vscodeCapabilities,
  type HostRequestMessage,
} from "@mamep2026/platform-api";
import {
  extractMessageId,
  handleVscodeInvoke,
  type IpcDeps,
} from "./ipc";

function request(
  kind: HostRequestMessage["kind"],
  payload: Record<string, unknown> = {},
  messageId = "req-1",
): HostRequestMessage {
  // 测试夹具：payload 形状按 kind 由调用方保证，handleVscodeInvoke 内部会经 Zod 校验。
  return {
    protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
    type: "request",
    messageId,
    kind,
    payload,
  } as HostRequestMessage;
}

function makeDeps(overrides: Partial<IpcDeps> = {}): IpcDeps {
  return {
    appVersion: () => "0.0.0-test",
    capabilities: () => vscodeCapabilities,
    colorTheme: () => "dark",
    isDev: () => true,
    clipboardWriteText: vi.fn(async () => undefined),
    clipboardReadText: vi.fn(async () => "from-clip"),
    ...overrides,
  };
}

describe("handleVscodeInvoke（VSCode 宿主 RPC 分发）", () => {
  it("get-capabilities 返回 VSCode 能力矩阵（骨架如实声明）", async () => {
    const result = await handleVscodeInvoke(
      request("get-capabilities"),
      makeDeps(),
    );
    expect(result).toEqual({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: "req-1",
      kind: "get-capabilities",
      ok: true,
      payload: vscodeCapabilities,
    });
  });

  it("get-app-version 返回注入的版本", async () => {
    const result = await handleVscodeInvoke(
      request("get-app-version"),
      makeDeps(),
    );
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toBe("0.0.0-test");
    }
  });

  it("copy-text-to-clipboard 调用剪贴板写入并返回 ok", async () => {
    const deps = makeDeps();
    const result = await handleVscodeInvoke(
      request("copy-text-to-clipboard", { text: "hi" }),
      deps,
    );
    expect(deps.clipboardWriteText).toHaveBeenCalledWith("hi");
    expect(result.type).toBe("response");
  });

  it("copy-text-to-clipboard 写入失败时返回结构化错误", async () => {
    const deps = makeDeps({
      clipboardWriteText: vi.fn(async () => {
        throw new Error("denied");
      }),
    });
    const result = await handleVscodeInvoke(
      request("copy-text-to-clipboard", { text: "hi" }),
      deps,
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("CLIPBOARD_WRITE_FAILED");
    }
  });

  it("read-text-from-clipboard 返回剪贴板读取值", async () => {
    const result = await handleVscodeInvoke(
      request("read-text-from-clipboard"),
      makeDeps(),
    );
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toBe("from-clip");
    }
  });

  it("get-color-theme 返回当前颜色主题", async () => {
    const result = await handleVscodeInvoke(
      request("get-color-theme"),
      makeDeps({ colorTheme: () => "light" }),
    );
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toBe("light");
    }
  });

  it("select-serial-port 返回能力错误（骨架未实现串口）", async () => {
    const result = await handleVscodeInvoke(
      request("select-serial-port", { portId: "COM3" }),
      makeDeps(),
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("SERIAL_UNSUPPORTED");
      expect(result.payload.category).toBe("capability");
    }
  });

  it("debug:get-state 在 dev 时返回宿主状态", async () => {
    const result = await handleVscodeInvoke(
      request("debug:get-state"),
      makeDeps(),
    );
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toMatchObject({
        platform: "vscode",
        appVersion: "0.0.0-test",
        colorTheme: "dark",
        capabilities: vscodeCapabilities,
      });
    }
  });

  it("debug:get-state 在非 dev 时禁用", async () => {
    const result = await handleVscodeInvoke(
      request("debug:get-state"),
      makeDeps({ isDev: () => false }),
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("DEBUG_PROBE_DISABLED");
    }
  });

  it("拒绝未知 kind（不允许任意方法名调用）", async () => {
    const result = await handleVscodeInvoke(
      {
        protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
        type: "request",
        messageId: "req-unknown",
        kind: "execute-arbitrary-command",
        payload: {},
      },
      makeDeps(),
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("HOST_MESSAGE_INVALID");
    }
  });

  it("拒绝非法 payload（缺失必填字段）", async () => {
    const result = await handleVscodeInvoke(
      request("copy-text-to-clipboard", {}),
      makeDeps(),
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("HOST_MESSAGE_INVALID");
    }
  });

  it("拒绝非 request 类型消息", async () => {
    const result = await handleVscodeInvoke(
      {
        protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
        type: "event",
        messageId: "evt-1",
        kind: "color-theme-changed",
        payload: { theme: "dark" },
      },
      makeDeps(),
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("HOST_MESSAGE_INVALID");
    }
  });

  it("extractMessageId 从不完整消息中提取 id", () => {
    expect(extractMessageId({ messageId: "abc" })).toBe("abc");
    expect(extractMessageId({})).toBe("");
    expect(extractMessageId(null)).toBe("");
    expect(extractMessageId("nope")).toBe("");
  });
});
