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
import { createMamepError, fail, ok } from "@mamep2026/domain";
import type { ConnectionState } from "@mamep2026/communication";
import {
  extractMessageId,
  handleVscodeInvoke,
  okResponse,
  type IpcDeps,
  type VscodeSessionLike,
} from "./ipc";
import { parseHostMessage } from "@mamep2026/platform-api";

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

function makeSession(
  overrides: Partial<VscodeSessionLike> = {},
): VscodeSessionLike {
  return {
    enumerateSerialPorts: vi.fn(async () => ok([])),
    connect: vi.fn(async () => ok(undefined)),
    connectTcp: vi.fn(async () => ok(undefined)),
    disconnect: vi.fn(async () => ok(undefined)),
    getConnectionState: vi.fn(() => "disconnected" as ConnectionState),
    setSlaveAddress: vi.fn(),
    readRow: vi.fn(async () => ok(0x1234)),
    writeRow: vi.fn(async () =>
      ok({ kind: "write-succeeded-no-verify" as const }),
    ),
    readAllRows: vi.fn(() => ({
      promise: Promise.resolve(
        ok({
          batchId: "b-1",
          totalRows: 1,
          eligibleRows: 1,
          successCount: 1,
          failureCount: 0,
          skippedCount: 0,
          cancelledCount: 0,
          startedAt: 0,
          completedAt: 1,
          durationMs: 1,
        }),
      ),
      cancel: vi.fn(),
    })),
    cancelBatch: vi.fn(),
    updatePollingTargets: vi.fn(),
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
    traceStart: vi.fn(),
    traceStop: vi.fn(),
    dispose: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<IpcDeps> = {}): IpcDeps {
  return {
    appVersion: () => "0.0.0-test",
    capabilities: () => vscodeCapabilities,
    colorTheme: () => "dark",
    isDev: () => true,
    clipboardWriteText: vi.fn(async () => undefined),
    clipboardReadText: vi.fn(async () => "from-clip"),
    session: makeSession(),
    sessionStats: () => ({ requestFrames: 0, responseFrames: 0 }),
    loadConnectionConfig: vi.fn(async () =>
      ok({ config: null, sourcePath: null }),
    ),
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

  it("select-serial-port 返回能力错误（VSCode 不走 Electron 授权选择流程）", async () => {
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
        sessionStats: { requestFrames: 0, responseFrames: 0 },
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

describe("RTU 会话 kind（VSCode 接线，2026-08-23）", () => {
  const profile = {
    id: "conn-1",
    name: "RTU",
    protocol: "rtu",
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "off",
    requestTimeoutMs: 1000,
    retryCount: 1,
    interRequestDelayMs: 50,
    addressAdjust: "off",
    recentPortHint: null,
  };

  const row = {
    rowId: "row-1",
    order: 1,
    name: "",
    comment: "",
    addressDraft: "",
    addressValue: { value: 0x1000 },
    dataType: "hex",
    pollingEnabled: false,
    traceEnabled: false,
    cellText: "",
    lastKnownRawValue: null,
    createdAt: 0,
    updatedAt: 0,
  };

  it("serial-enumerate 返回端口列表", async () => {
    const session = makeSession({
      enumerateSerialPorts: vi.fn(async () =>
        ok([{ portId: "COM4", label: "Fake (COM4)" }]),
      ),
    });
    const result = await handleVscodeInvoke(
      request("serial-enumerate"),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toEqual([{ portId: "COM4", label: "Fake (COM4)" }]);
    }
  });

  it("session-connect 重建 profile 并调用 connect", async () => {
    const session = makeSession();
    const result = await handleVscodeInvoke(
      request("session-connect", {
        portId: "COM4",
        profile,
        slaveAddress: 1,
      }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    expect(session.connect).toHaveBeenCalledWith(
      "COM4",
      expect.objectContaining({ id: "conn-1", protocol: "rtu", baudRate: 9600 }),
      1,
    );
  });

  it("session-connect 失败时返回结构化错误", async () => {
    const session = makeSession({
      connect: vi.fn(async () =>
        fail(
          createMamepError({
            code: "SERIAL_PORT_IN_USE",
            category: "transport",
            retryable: false,
            userMessageKey: "errors.serialPortInUse",
            technicalMessage: "in use",
          }),
        ),
      ),
    });
    const result = await handleVscodeInvoke(
      request("session-connect", { portId: "COM4", profile, slaveAddress: 1 }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("SERIAL_PORT_IN_USE");
    }
  });

  it("session-read-row 重建 row 并返回数值", async () => {
    const session = makeSession();
    const result = await handleVscodeInvoke(
      request("session-read-row", { row }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    if (result.type === "response") expect(result.payload).toBe(0x1234);
    expect(session.readRow).toHaveBeenCalledWith(
      expect.objectContaining({ rowId: "row-1", dataType: "hex" }),
    );
  });

  it("session-write-row 返回 WriteOutcome payload", async () => {
    const result = await handleVscodeInvoke(
      request("session-write-row", { row }),
      makeDeps(),
    );
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toEqual({ kind: "write-succeeded-no-verify" });
    }
  });

  it("session-batch-read 携带 batchId 调用 readAllRows 并返回汇总（行结果走 poll-result 事件）", async () => {
    const session = makeSession();
    const result = await handleVscodeInvoke(
      request("session-batch-read", {
        batchId: "batch-abc",
        rows: [{ key: "a", address: 1 }],
      }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    expect(session.readAllRows).toHaveBeenCalledWith(
      [{ key: "a", address: 1 }],
      "batch-abc",
    );
    if (result.type === "response") {
      expect(result.payload).toMatchObject({
        summary: { batchId: "b-1", successCount: 1 },
      });
    }
  });

  it("session-batch-cancel 按 batchId 调用 cancelBatch", async () => {
    const session = makeSession();
    const result = await handleVscodeInvoke(
      request("session-batch-cancel", { batchId: "batch-abc" }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    expect(session.cancelBatch).toHaveBeenCalledWith("batch-abc");
  });

  it("session-get-state 返回连接状态", async () => {
    const session = makeSession({
      getConnectionState: vi.fn(() => "connected" as ConnectionState),
    });
    const result = await handleVscodeInvoke(
      request("session-get-state"),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toEqual({ connectionState: "connected" });
    }
  });

  it("session-set-slave-address 调用 setSlaveAddress", async () => {
    const session = makeSession();
    const result = await handleVscodeInvoke(
      request("session-set-slave-address", { slave: 7 }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    expect(session.setSlaveAddress).toHaveBeenCalledWith(7);
  });

  it("session-trace-start 调用 traceStart", async () => {
    const session = makeSession();
    const result = await handleVscodeInvoke(
      request("session-trace-start", { key: "k", address: 1, speedMs: 100 }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    expect(session.traceStart).toHaveBeenCalledWith("k", 1, 100);
  });

  it("会话操作抛异常时返回 SESSION_INTERNAL_ERROR", async () => {
    const session = makeSession({
      readRow: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const result = await handleVscodeInvoke(
      request("session-read-row", { row }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("SESSION_INTERNAL_ERROR");
    }
  });
});

describe("TCP 会话 kind（2026-08-23 两端 TCP 接线）", () => {
  const tcpProfile = {
    id: "conn-tcp-1",
    name: "PLC",
    protocol: "tcp",
    host: "192.168.1.10",
    port: 502,
    unitId: 0,
    connectTimeoutMs: 5000,
    requestTimeoutMs: 1000,
    retryCount: 1,
    autoReconnect: false,
    interRequestDelayMs: 50,
  };

  it("session-tcp-connect 重建 TCP profile 并调用 connectTcp", async () => {
    const session = makeSession();
    const result = await handleVscodeInvoke(
      request("session-tcp-connect", { profile: tcpProfile }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    expect(session.connectTcp).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "conn-tcp-1",
        protocol: "tcp",
        host: "192.168.1.10",
        port: 502,
      }),
    );
  });

  it("session-tcp-connect 失败时返回结构化错误", async () => {
    const session = makeSession({
      connectTcp: vi.fn(async () =>
        fail(
          createMamepError({
            code: "TCP_CONNECTION_FAILED",
            category: "connection",
            retryable: true,
            userMessageKey: "errors.tcpConnectionFailed",
            technicalMessage: "refused",
          }),
        ),
      ),
    });
    const result = await handleVscodeInvoke(
      request("session-tcp-connect", { profile: tcpProfile }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("TCP_CONNECTION_FAILED");
    }
  });

  it("session-tcp-connect 拒绝非 TCP profile", async () => {
    const result = await handleVscodeInvoke(
      request("session-tcp-connect", {
        profile: { ...tcpProfile, protocol: "rtu" },
      }),
      makeDeps(),
    );
    expect(result.type).toBe("error");
  });
});

describe("okResponse 序列化归一化（2026-08-23 连接卡死根因修复）", () => {
  it("undefined payload 归一为 null（postMessage 结构化克隆会丢弃 undefined 属性）", () => {
    const reply = okResponse(request("session-connect"), undefined);
    expect(reply.payload).toBeNull();
  });

  it("null payload 原样保留", () => {
    const reply = okResponse(request("session-connect"), null);
    expect(reply.payload).toBeNull();
  });

  it("模拟结构化克隆后的 response 仍能通过接收端 hostResponseSchema 校验", () => {
    // 回归保护：Result<void> 的 value=undefined → okResponse 归一为 null；
    // 即使序列化边界丢 undefined 属性，克隆后 envelope 仍可被 parseHostMessage 接受。
    const reply = okResponse(request("session-connect"), undefined);
    const cloned = JSON.parse(JSON.stringify(reply));
    const parsed = parseHostMessage(cloned);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.payload).toBeNull();
  });
});
