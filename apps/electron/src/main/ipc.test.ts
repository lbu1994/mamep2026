/**
 * 安全 IPC 处理核心单测（docs/AGENTS.md §23：未知 kind 拒绝、输入校验、发送者校验、探针禁用）。
 * handleRequest/handleInvoke 为异步（主进程 TCP 会话承载两端 TCP 接线）。
 */
import { describe, expect, it, vi } from "vitest";
import type { ConnectionState } from "@mamep2026/communication";
import {
  createEmptyWorkspace,
  createMamepError,
  fail,
  ok,
  workspaceSchemaVersion,
} from "@mamep2026/domain";
import type { TcpConnectionProfile } from "@mamep2026/domain";
import { serializeWorkspace } from "@mamep2026/workspace";
import type { WorkspaceRepositoryPort } from "@mamep2026/workspace";
import { createEmptyPluginStoreData } from "@mamep2026/plugin-api";
import {
  HOST_MESSAGE_PROTOCOL_VERSION,
  electronCapabilities,
  type HostRequestMessage,
} from "@mamep2026/platform-api";
import {
  extractMessageId,
  handleInvoke,
  handleRequest,
  type ElectronSessionLike,
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

function makeSession(
  overrides: Partial<ElectronSessionLike> = {},
): ElectronSessionLike {
  return {
    connectTcp: vi.fn(async () => ok(undefined)),
    disconnect: vi.fn(async () => ok(undefined)),
    setUnitId: vi.fn(),
    getConnectionState: vi.fn(() => "disconnected" as ConnectionState),
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

function makeWorkspaceRepo(
  overrides: Partial<WorkspaceRepositoryPort> = {},
): WorkspaceRepositoryPort {
  return {
    load: vi.fn(async () => ok(createEmptyWorkspace())),
    save: vi.fn(async () => ok(undefined)),
    clear: vi.fn(async () => ok(undefined)),
    reset: vi.fn(async () => ok(undefined)),
    export: vi.fn(async () => ok(serializeWorkspace(createEmptyWorkspace()))),
    import: vi.fn(async () => ok(undefined)),
    createBackup: vi.fn(async () => ok(undefined)),
    getRecoveryInfo: vi.fn(() => null),
    ...overrides,
  };
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
    session: makeSession(),
    saveTextFile: vi.fn(async () =>
      ok({ saved: true, filePath: "C:\\logs\\comm-log.csv" }),
    ),
    openTextFile: vi.fn(async () => ok({ content: null })),
    workspace: makeWorkspaceRepo(),
    pluginStore: {
      load: vi.fn(async () => ok(createEmptyPluginStoreData())),
      save: vi.fn(async () => ok(undefined)),
    },
    ...overrides,
  };
}

describe("handleInvoke（安全 IPC 分发）", () => {
  it("get-capabilities 返回 Electron 能力矩阵（RTU/TCP 已接线）", async () => {
    const result = await handleInvoke(request("get-capabilities"), {
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
    expect(electronCapabilities.modbusTcp).toBe(true);
  });

  it("get-app-version 返回注入的版本", async () => {
    const result = await handleInvoke(request("get-app-version"), {
      isSenderMainWindow: true,
      deps: makeDeps(),
    });
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toBe("0.0.0-test");
    }
  });

  it("copy-text-to-clipboard 调用剪贴板写入并返回 ok", async () => {
    const deps = makeDeps();
    const result = await handleInvoke(
      request("copy-text-to-clipboard", { text: "hi" }),
      {
        isSenderMainWindow: true,
        deps,
      },
    );
    expect(deps.clipboardWriteText).toHaveBeenCalledWith("hi");
    expect(result.type).toBe("response");
  });

  it("read-text-from-clipboard 返回剪贴板读取值", async () => {
    const result = await handleInvoke(request("read-text-from-clipboard"), {
      isSenderMainWindow: true,
      deps: makeDeps(),
    });
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toBe("from-clip");
    }
  });

  it("debug:get-state 在未打包时返回主进程状态", async () => {
    const result = await handleInvoke(request("debug:get-state"), {
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

  it("debug:get-state 在打包构建时禁用", async () => {
    const result = await handleInvoke(request("debug:get-state"), {
      isSenderMainWindow: true,
      deps: makeDeps({ isPackaged: () => true }),
    });
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("DEBUG_PROBE_DISABLED");
    }
  });

  it("未知 kind 被拒绝（HOST_MESSAGE_INVALID）", async () => {
    const result = await handleInvoke(
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

  it("非法 payload 被拒绝（copy 缺 text）", async () => {
    const result = await handleInvoke(request("copy-text-to-clipboard", {}), {
      isSenderMainWindow: true,
      deps: makeDeps(),
    });
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("HOST_MESSAGE_INVALID");
    }
  });

  it("非主窗口发送者被拒绝", async () => {
    const result = await handleInvoke(
      request("get-capabilities", {}, "req-other"),
      {
        isSenderMainWindow: false,
        deps: makeDeps(),
      },
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("HOST_MESSAGE_SENDER_REJECTED");
      expect(result.messageId).toBe("req-other");
    }
  });

  it("无法解析的消息仍尽力回填 messageId", async () => {
    const result = await handleInvoke("not-an-object", {
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
  it("能力矩阵与 Electron 能力一致（RTU/TCP 支持 / enumerated 下拉选择）", async () => {
    const result = await handleRequest(request("get-capabilities"), makeDeps());
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toEqual(electronCapabilities);
      expect(result.payload).toMatchObject({
        modbusRtu: true,
        modbusTcp: true,
        serialPorts: "enumerated",
      });
    }
  });

  it("select-serial-port：解析挂起选择成功返回 ok(null)", async () => {
    const resolveSerialPortSelection = vi.fn(() => true);
    const deps = makeDeps({ resolveSerialPortSelection });
    const result = await handleRequest(
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

  it("select-serial-port：空串 portId（取消）同样解析挂起选择", async () => {
    const resolveSerialPortSelection = vi.fn(() => true);
    const deps = makeDeps({ resolveSerialPortSelection });
    const result = await handleRequest(
      request("select-serial-port", { portId: "" }),
      deps,
      { tag: "wc" },
    );
    expect(resolveSerialPortSelection).toHaveBeenCalledWith("", {
      tag: "wc",
    });
    expect(result.type).toBe("response");
  });

  it("select-serial-port：无挂起选择返回 SERIAL_PICKER_NOT_ACTIVE", async () => {
    const result = await handleRequest(
      request("select-serial-port", { portId: "p1" }),
      makeDeps(),
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("SERIAL_PICKER_NOT_ACTIVE");
    }
  });

  it("select-serial-port：经 handleInvoke 完整链路（发送者校验 + Zod + 分发）", async () => {
    const resolveSerialPortSelection = vi.fn(() => true);
    const deps = makeDeps({ resolveSerialPortSelection });
    const result = await handleInvoke(
      request("select-serial-port", { portId: "p2" }),
      {
        isSenderMainWindow: true,
        sender: { tag: "wc" },
        deps,
      },
    );
    expect(result.type).toBe("response");
    expect(resolveSerialPortSelection).toHaveBeenCalledWith("p2", {
      tag: "wc",
    });
  });

  it("select-serial-port：非法 payload 被拒绝（缺 portId）", async () => {
    const result = await handleInvoke(request("select-serial-port", {}), {
      isSenderMainWindow: true,
      deps: makeDeps(),
    });
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("HOST_MESSAGE_INVALID");
    }
  });
});

describe("主进程 TCP 会话 kind（2026-08-23 两端 TCP 接线）", () => {
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
  };

  it("session-tcp-connect 重建 TCP profile 并调用主进程会话 connectTcp", async () => {
    const session = makeSession();
    const result = await handleRequest(
      request("session-tcp-connect", { profile: tcpProfile }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    expect(session.connectTcp).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "tcp",
        host: "192.168.1.10",
        port: 502,
      }) as TcpConnectionProfile,
    );
  });

  it("session-read-row 经主进程会话 readRow 返回数值", async () => {
    const session = makeSession();
    const result = await handleRequest(
      request("session-read-row", {
        row: {
          rowId: "row-1",
          order: 1,
          name: "",
          comment: "",
          addressDraft: "",
          addressValue: { value: 1 },
          dataType: "hex",
          pollingEnabled: false,
          traceEnabled: false,
          cellText: "",
          registerValues: null,
          createdAt: 0,
          updatedAt: 0,
        },
      }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    if (result.type === "response") expect(result.payload).toBe(0x1234);
  });

  it("session-write-row 携带 writeVerify 调用会话 writeRow 并投影 WriteOutcome（2026-08-26）", async () => {
    const session = makeSession({
      writeRow: vi.fn(async () =>
        ok({
          kind: "write-succeeded-verify-matched" as const,
          readValues: [0x04d2],
        }),
      ),
    });
    const result = await handleRequest(
      request("session-write-row", {
        row: {
          rowId: "row-1",
          order: 1,
          name: "",
          comment: "",
          addressDraft: "",
          addressValue: { value: 0x1000 },
          dataType: "hex",
          pollingEnabled: false,
          traceEnabled: false,
          cellText: "04D2",
          registerValues: null,
          createdAt: 0,
          updatedAt: 0,
        },
        writeVerify: { mode: "immediate", delayMs: null },
        route: { unitAddress: 1, protocol: "tcp" },
      }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    expect(session.writeRow).toHaveBeenCalledWith(
      expect.objectContaining({ rowId: "row-1", cellText: "04D2" }),
      { writeVerify: { mode: "immediate", delayMs: null } },
      { unitAddress: 1, protocol: "tcp" },
    );
    if (result.type === "response") {
      expect(result.payload).toEqual({
        kind: "write-succeeded-verify-matched",
        readValues: [0x04d2],
      });
    }
  });

  it("session-get-state 返回主进程会话连接状态", async () => {
    const session = makeSession({
      getConnectionState: vi.fn(() => "connected" as ConnectionState),
    });
    const result = await handleRequest(
      request("session-get-state"),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toEqual({ connectionState: "connected" });
    }
  });

  it("session-set-unit-id 调用主进程会话 setUnitId（TCP Unit ID 会话内动态修改，2026-08-25）", async () => {
    const session = makeSession();
    const result = await handleRequest(
      request("session-set-unit-id", { unitId: 9 }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    expect(session.setUnitId).toHaveBeenCalledWith(9);
  });

  it("session-batch-read 携带 batchId 调用 readAllRows 并返回汇总（ADR-025）", async () => {
    const session = makeSession();
    const result = await handleRequest(
      request("session-batch-read", {
        batchId: "batch-abc",
        rows: [{ key: "a", sheetId: "sheet-a", address: 1 }],
        route: { unitAddress: 1, protocol: "tcp" },
      }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    expect(session.readAllRows).toHaveBeenCalledWith(
      [{ key: "a", sheetId: "sheet-a", address: 1 }],
      "batch-abc",
      { unitAddress: 1, protocol: "tcp" },
    );
    if (result.type === "response") {
      expect(result.payload).toMatchObject({ summary: { batchId: "b-1" } });
    }
  });

  it("session-batch-cancel 按 batchId 调用 cancelBatch", async () => {
    const session = makeSession();
    const result = await handleRequest(
      request("session-batch-cancel", { batchId: "batch-abc" }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("response");
    expect(session.cancelBatch).toHaveBeenCalledWith("batch-abc");
  });

  it("session-tcp-connect 失败时返回结构化错误", async () => {
    const session = makeSession({
      connectTcp: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "TCP_CONNECTION_FAILED",
          category: "connection" as const,
          severity: "error" as const,
          retryable: true,
          userMessageKey: "errors.tcpConnectionFailed",
          technicalMessage: "refused",
        },
      })),
    });
    const result = await handleRequest(
      request("session-tcp-connect", { profile: tcpProfile }),
      makeDeps({ session }),
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("TCP_CONNECTION_FAILED");
    }
  });

  it("save-text-file 转发主进程落盘并返回 saved 响应（2026-08-28）", async () => {
    const saveTextFile = vi.fn(async () =>
      ok({ saved: true, filePath: "C:\\logs\\comm-log.csv" }),
    );
    const result = await handleRequest(
      request("save-text-file", {
        suggestedName: "comm-log-rtu-20260828-102030.csv",
        content: "seq,timestamp\r\n",
        mimeType: "text/csv",
      }),
      makeDeps({ saveTextFile }),
    );
    expect(result.type).toBe("response");
    expect(saveTextFile).toHaveBeenCalledWith({
      suggestedName: "comm-log-rtu-20260828-102030.csv",
      content: "seq,timestamp\r\n",
      mimeType: "text/csv",
    });
    if (result.type === "response") {
      expect(result.payload).toEqual({
        saved: true,
        filePath: "C:\\logs\\comm-log.csv",
      });
    }
  });

  it("save-text-file 用户取消时原样返回 saved:false（非错误）", async () => {
    const saveTextFile = vi.fn(async () =>
      ok({ saved: false, filePath: null }),
    );
    const result = await handleRequest(
      request("save-text-file", {
        suggestedName: "comm-log.csv",
        content: "x",
      }),
      makeDeps({ saveTextFile }),
    );
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toEqual({ saved: false, filePath: null });
    }
  });

  it("open-text-file 转发主进程读取并返回 content 响应（2026-08-29）", async () => {
    const openTextFile = vi.fn(async () =>
      ok({ content: '{"schemaVersion":4}' }),
    );
    const result = await handleRequest(
      request("open-text-file", { suggestedName: "mamep-workspace.json" }),
      makeDeps({ openTextFile }),
    );
    expect(result.type).toBe("response");
    expect(openTextFile).toHaveBeenCalledWith({
      suggestedName: "mamep-workspace.json",
    });
    if (result.type === "response") {
      expect(result.payload).toEqual({ content: '{"schemaVersion":4}' });
    }
  });

  it("open-text-file 无 suggestedName 时不传 options（2026-08-29）", async () => {
    const openTextFile = vi.fn(async () => ok({ content: null }));
    const result = await handleRequest(
      request("open-text-file", {}),
      makeDeps({ openTextFile }),
    );
    expect(result.type).toBe("response");
    expect(openTextFile).toHaveBeenCalledWith(undefined);
    if (result.type === "response") {
      expect(result.payload).toEqual({ content: null });
    }
  });

  it("open-text-file 用户取消时原样返回 content:null（非错误，2026-08-29）", async () => {
    const openTextFile = vi.fn(async () => ok({ content: null }));
    const result = await handleRequest(
      request("open-text-file", {}),
      makeDeps({ openTextFile }),
    );
    expect(result.type).toBe("response");
    if (result.type === "response") {
      expect(result.payload).toEqual({ content: null });
    }
  });

  it("workspace-load 转发主进程文件仓储并返回序列化 content（2026-08-30）", async () => {
    // createEmptyWorkspace 含 Date.now()/随机 id（非确定性），用固定实例比对序列化结果。
    const fixed = { ...createEmptyWorkspace(), name: "LoadFixed" };
    const workspace = makeWorkspaceRepo({
      load: vi.fn(async () => ok(fixed)),
    });
    const result = await handleRequest(
      request("workspace-load", {}),
      makeDeps({ workspace }),
    );
    expect(result.type).toBe("response");
    expect(workspace.load).toHaveBeenCalled();
    if (result.type === "response") {
      expect(result.payload).toEqual({
        content: serializeWorkspace(fixed),
        recoveryInfo: null,
      });
    }
  });

  it("workspace-load 仓储失败时错误投影 category/userMessageKey 原样往返（ADR-028）", async () => {
    const workspace = makeWorkspaceRepo({
      load: vi.fn(async () =>
        fail(
          createMamepError({
            code: "PERSISTENCE_LOAD_FAILED",
            category: "persistence",
            userMessageKey: "errors.persistenceError",
            technicalMessage: "boom",
          }),
        ),
      ),
    });
    const result = await handleRequest(
      request("workspace-load", {}),
      makeDeps({ workspace }),
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("PERSISTENCE_LOAD_FAILED");
      expect(result.payload.category).toBe("persistence");
      expect(result.payload.userMessageKey).toBe("errors.persistenceError");
    }
  });

  it("workspace-save 合法 content 经 JSON.parse + parseWorkspace 校验后落盘（2026-08-30）", async () => {
    const workspace = makeWorkspaceRepo();
    const source = { ...createEmptyWorkspace(), name: "SaveMe" };
    const content = serializeWorkspace(source);
    const result = await handleRequest(
      request("workspace-save", { content }),
      makeDeps({ workspace }),
    );
    expect(result.type).toBe("response");
    expect(workspace.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "SaveMe",
        schemaVersion: workspaceSchemaVersion,
      }),
    );
  });

  it("workspace-save 非法 content 返回校验错误且不落盘（2026-08-30）", async () => {
    const workspace = makeWorkspaceRepo();
    const result = await handleRequest(
      request("workspace-save", { content: "{ not-json" }),
      makeDeps({ workspace }),
    );
    expect(result.type).toBe("error");
    expect(workspace.save).not.toHaveBeenCalled();
    if (result.type === "error") {
      expect(result.payload.category).toBe("persistence");
    }
  });

  it("workspace-clear 清除主进程文件仓储（2026-08-30）", async () => {
    const workspace = makeWorkspaceRepo();
    const result = await handleRequest(
      request("workspace-clear", {}),
      makeDeps({ workspace }),
    );
    expect(result.type).toBe("response");
    expect(workspace.clear).toHaveBeenCalled();
  });

  it("workspace-create-backup 转发主进程文件仓储备份（ADR-049）", async () => {
    const workspace = makeWorkspaceRepo();
    const result = await handleRequest(
      request("workspace-create-backup", {}),
      makeDeps({ workspace }),
    );
    expect(result.type).toBe("response");
    expect(workspace.createBackup).toHaveBeenCalled();
  });
});

describe("plugin-store kinds（2026-08-30，ADR-038 插件安装入口）", () => {
  const manifestPayload = {
    id: "installed-a",
    name: "Installed A",
    version: "1.0.0",
    apiVersion: "2.0",
    description: "A user-installed plugin",
    platform: { web: true, node: false },
    permissions: ["ui-contribution"],
    contributes: { panels: [] },
  };

  function makePluginStore() {
    return {
      load: vi.fn(async () => ok(createEmptyPluginStoreData())),
      save: vi.fn(async () => ok(undefined)),
    };
  }

  it("plugin-store-load 转发主进程插件存储并返回数据", async () => {
    const pluginStore = makePluginStore();
    const result = await handleRequest(
      request("plugin-store-load", {}),
      makeDeps({ pluginStore }),
    );
    expect(result.type).toBe("response");
    expect(pluginStore.load).toHaveBeenCalled();
    if (result.type === "response") {
      expect(result.payload).toEqual({
        schemaVersion: 5,
        plugins: [],
      });
    }
  });

  it("plugin-store-load 失败时错误投影 category/userMessageKey 原样往返（ADR-028）", async () => {
    const pluginStore = {
      ...makePluginStore(),
      load: vi.fn(async () =>
        fail(
          createMamepError({
            code: "PLUGIN_STORE_LOAD_FAILED",
            category: "plugin",
            userMessageKey: "errors.pluginStoreError",
            technicalMessage: "boom",
          }),
        ),
      ),
    };
    const result = await handleRequest(
      request("plugin-store-load", {}),
      makeDeps({ pluginStore }),
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("PLUGIN_STORE_LOAD_FAILED");
      expect(result.payload.category).toBe("plugin");
      expect(result.payload.userMessageKey).toBe("errors.pluginStoreError");
    }
  });

  it("plugin-store-save 转发载荷给主进程插件存储", async () => {
    const pluginStore = makePluginStore();
    const data = {
      schemaVersion: 5,
      plugins: [{ manifest: manifestPayload, enabled: true }],
    };
    const result = await handleRequest(
      request("plugin-store-save", { data }),
      makeDeps({ pluginStore }),
    );
    expect(result.type).toBe("response");
    expect(pluginStore.save).toHaveBeenCalledWith(data);
  });

  it("plugin-store-save 成功 → 触发宿主侧插件执行面同步（ADR-055）", async () => {
    const pluginStore = makePluginStore();
    const onPluginStoreSaved = vi.fn();
    const result = await handleRequest(
      request("plugin-store-save", {
        data: { schemaVersion: 5, plugins: [] },
      }),
      makeDeps({ pluginStore, onPluginStoreSaved }),
    );
    expect(result.type).toBe("response");
    expect(onPluginStoreSaved).toHaveBeenCalledTimes(1);
  });

  it("plugin-store-save 失败 → 不触发宿主侧插件同步", async () => {
    const pluginStore = {
      ...makePluginStore(),
      save: vi.fn(async () =>
        fail(
          createMamepError({
            code: "PLUGIN_STORE_WRITE_FAILED",
            category: "plugin",
            userMessageKey: "errors.pluginStoreError",
            technicalMessage: "boom",
          }),
        ),
      ),
    };
    const onPluginStoreSaved = vi.fn();
    const result = await handleRequest(
      request("plugin-store-save", {
        data: { schemaVersion: 5, plugins: [] },
      }),
      makeDeps({ pluginStore, onPluginStoreSaved }),
    );
    expect(result.type).toBe("error");
    expect(onPluginStoreSaved).not.toHaveBeenCalled();
  });

  it("plugin-store-save 失败时错误投影 category/userMessageKey 原样往返", async () => {
    const pluginStore = {
      ...makePluginStore(),
      save: vi.fn(async () =>
        fail(
          createMamepError({
            code: "PLUGIN_STORE_WRITE_FAILED",
            category: "plugin",
            userMessageKey: "errors.pluginStoreError",
            technicalMessage: "boom",
          }),
        ),
      ),
    };
    const result = await handleRequest(
      request("plugin-store-save", {
        data: { schemaVersion: 5, plugins: [] },
      }),
      makeDeps({ pluginStore }),
    );
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.payload.code).toBe("PLUGIN_STORE_WRITE_FAILED");
      expect(result.payload.category).toBe("plugin");
    }
  });
});

describe("plugin runtime kinds（2026-08-31，ADR-039：Phase A 返回能力错误）", () => {
  it("plugin-runtime-load/unload/rpc/contribution-query → PLUGIN_RUNTIME_NOT_AVAILABLE", async () => {
    const cases: Array<{
      kind: HostRequestMessage["kind"];
      payload: Record<string, unknown>;
    }> = [
      { kind: "plugin-runtime-load", payload: { pluginId: "demo" } },
      { kind: "plugin-runtime-unload", payload: { pluginId: "demo" } },
      {
        kind: "plugin-rpc",
        payload: { pluginId: "demo", method: "ping" },
      },
      { kind: "plugin-contribution-query", payload: {} },
    ];
    for (const c of cases) {
      const result = await handleRequest(
        request(c.kind, c.payload),
        makeDeps(),
      );
      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.payload.code).toBe("PLUGIN_RUNTIME_NOT_AVAILABLE");
        expect(result.payload.category).toBe("plugin");
      }
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

describe("workspace recovery IPC", () => {
  it("exports without restoring and returns the confirmed workspace only on restore", async () => {
    const workspace = createEmptyWorkspace();
    const recover = vi.fn(async () => ok(workspace));
    const exportRecovery = vi.fn(async () => ok("original envelope"));
    const deps = makeDeps({
      workspace: { ...makeWorkspaceRepo(), recover, exportRecovery },
    });
    const exported = await handleRequest(
      request("workspace-recovery", { action: "export" }),
      deps,
    );
    expect(exported).toMatchObject({
      type: "response",
      payload: { content: "original envelope" },
    });
    expect(recover).not.toHaveBeenCalled();
    const restored = await handleRequest(
      request("workspace-recovery", { action: "restore" }),
      deps,
    );
    expect(restored).toMatchObject({
      type: "response",
      payload: { content: serializeWorkspace(workspace) },
    });
    expect(recover).toHaveBeenCalledTimes(1);
  });
});
