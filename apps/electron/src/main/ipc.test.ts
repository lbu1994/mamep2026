/**
 * 安全 IPC 处理核心单测（docs/AGENTS.md §23：未知 kind 拒绝、输入校验、发送者校验、探针禁用）。
 */
import { describe, expect, it, vi } from "vitest";
import {
  HOST_MESSAGE_PROTOCOL_VERSION,
  electronCapabilities,
  type HostRequestMessage,
} from "@mamep2026/platform-api";
import {
  extractMessageId,
  handleInvoke,
  handleRequest,
  type IpcDeps,
} from "./ipc";

function request(
  kind: HostRequestMessage["kind"],
  payload: Record<string, unknown> = {},
  messageId = "req-1",
): HostRequestMessage {
  // 测试夹具：payload 形状按 kind 由调用方保证，handleInvoke 内部会经 Zod 校验。
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
    isPackaged: () => false,
    windowCount: () => 2,
    connectionState: () => "disconnected",
    uptimeMs: () => 123,
    clipboardWriteText: vi.fn(),
    clipboardReadText: () => "from-clip",
    resolveSerialPortSelection: vi.fn(() => false),
    ...overrides,
  };
}

describe("handleInvoke（安全 IPC 分发）", () => {
  it("get-capabilities 返回 Electron 能力矩阵（Web Serial MVP）", () => {
    const result = handleInvoke(request("get-capabilities"), {
      isSenderMainWindow: true,
      deps: makeDeps(),
    });
    expect(result).toEqual({
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "response",
      messageId: "req-1",
      kind: "get-capabilities",
      ok: true,
      payload: electronCapabilities,
    });
  });

  it("get-app-version 返回注入的版本", () => {
    const result = handleInvoke(request("get-app-version"), {
      isSenderMainWindow: true,
      deps: makeDeps(),
    });
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toBe("0.0.0-test");
    }
  });

  it("copy-text-to-clipboard 调用剪贴板写入并返回 ok", () => {
    const deps = makeDeps();
    const result = handleInvoke(request("copy-text-to-clipboard", { text: "hi" }), {
      isSenderMainWindow: true,
      deps,
    });
    expect(deps.clipboardWriteText).toHaveBeenCalledWith("hi");
    expect(result.type).toBe("response");
  });

  it("read-text-from-clipboard 返回剪贴板读取值", () => {
    const result = handleInvoke(request("read-text-from-clipboard"), {
      isSenderMainWindow: true,
      deps: makeDeps(),
    });
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toBe("from-clip");
    }
  });

  it("debug:get-state 在未打包时返回主进程状态", () => {
    const result = handleInvoke(request("debug:get-state"), {
      isSenderMainWindow: true,
      deps: makeDeps(),
    });
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toMatchObject({
        platform: "electron",
        appVersion: "0.0.0-test",
        packaged: false,
        windowCount: 2,
        connectionState: "disconnected",
        uptimeMs: 123,
      });
    }
  });

  it("debug:get-state 在打包构建时禁用", () => {
    const result = handleInvoke(request("debug:get-state"), {
      isSenderMainWindow: true,
      deps: makeDeps({ isPackaged: () => true }),
    });
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("DEBUG_PROBE_DISABLED");
    }
  });

  it("未知 kind 被拒绝（HOST_MESSAGE_INVALID）", () => {
    const result = handleInvoke(
      {
        protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
        type: "request",
        messageId: "req-x",
        kind: "execute-arbitrary-command",
        payload: {},
      },
      { isSenderMainWindow: true, deps: makeDeps() },
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("HOST_MESSAGE_INVALID");
      expect(result.messageId).toBe("req-x");
    }
  });

  it("非法 payload 被拒绝（copy 缺 text）", () => {
    const result = handleInvoke(request("copy-text-to-clipboard", {}), {
      isSenderMainWindow: true,
      deps: makeDeps(),
    });
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("HOST_MESSAGE_INVALID");
    }
  });

  it("非主窗口发送者被拒绝", () => {
    const result = handleInvoke(request("get-capabilities", {}, "req-other"), {
      isSenderMainWindow: false,
      deps: makeDeps(),
    });
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("HOST_MESSAGE_SENDER_REJECTED");
      expect(result.messageId).toBe("req-other");
    }
  });

  it("无法解析的消息仍尽力回填 messageId", () => {
    const result = handleInvoke("not-an-object", {
      isSenderMainWindow: false,
      deps: makeDeps(),
    });
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("HOST_MESSAGE_SENDER_REJECTED");
      expect(result.messageId).toBe("");
    }
  });
});

describe("handleRequest（直接分发）", () => {
  it("能力矩阵与 Electron 能力一致（RTU 支持 / enumerated 下拉选择）", () => {
    const result = handleRequest(request("get-capabilities"), makeDeps());
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toEqual(electronCapabilities);
      expect(result.payload).toMatchObject({
        modbusRtu: true,
        serialPorts: "enumerated",
      });
    }
  });

  it("select-serial-port：解析挂起选择成功返回 ok(null)", () => {
    const resolveSerialPortSelection = vi.fn(() => true);
    const deps = makeDeps({ resolveSerialPortSelection });
    const result = handleRequest(
      request("select-serial-port", { portId: "p1" }),
      deps,
      { tag: "wc" },
    );
    expect(resolveSerialPortSelection).toHaveBeenCalledWith("p1", {
      tag: "wc",
    });
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.kind).toBe("select-serial-port");
      expect(result.payload).toBeNull();
    }
  });

  it("select-serial-port：空串 portId（取消）同样解析挂起选择", () => {
    const resolveSerialPortSelection = vi.fn(() => true);
    const deps = makeDeps({ resolveSerialPortSelection });
    const result = handleRequest(
      request("select-serial-port", { portId: "" }),
      deps,
      { tag: "wc" },
    );
    expect(resolveSerialPortSelection).toHaveBeenCalledWith("", {
      tag: "wc",
    });
    expect(result.type).toBe("response");
  });

  it("select-serial-port：无挂起选择返回 SERIAL_PICKER_NOT_ACTIVE", () => {
    const result = handleRequest(
      request("select-serial-port", { portId: "p1" }),
      makeDeps(),
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("SERIAL_PICKER_NOT_ACTIVE");
    }
  });

  it("select-serial-port：经 handleInvoke 完整链路（发送者校验 + Zod + 分发）", () => {
    const resolveSerialPortSelection = vi.fn(() => true);
    const deps = makeDeps({ resolveSerialPortSelection });
    const result = handleInvoke(request("select-serial-port", { portId: "p2" }), {
      isSenderMainWindow: true,
      sender: { tag: "wc" },
      deps,
    });
    expect(result.type).toBe("response");
    expect(resolveSerialPortSelection).toHaveBeenCalledWith("p2", {
      tag: "wc",
    });
  });

  it("select-serial-port：非法 payload 被拒绝（缺 portId）", () => {
    const result = handleInvoke(request("select-serial-port", {}), {
      isSenderMainWindow: true,
      deps: makeDeps(),
    });
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("HOST_MESSAGE_INVALID");
    }
  });
});

describe("extractMessageId", () => {
  it("非对象返回空串", () => {
    expect(extractMessageId(null)).toBe("");
    expect(extractMessageId(42)).toBe("");
  });

  it("提取合法 messageId", () => {
    expect(extractMessageId({ messageId: "abc" })).toBe("abc");
    expect(extractMessageId({ messageId: "" })).toBe("");
    expect(extractMessageId({ messageId: 123 })).toBe("");
  });
});
