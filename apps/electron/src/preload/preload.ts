/**
 * Electron Preload（docs/TECH_DESIGN.md §6.2、§22.1）。
 * 只暴露最小化、类型化的白名单 API（MamepHostApi）；不暴露通用 ipcRenderer、
 * 不暴露文件系统 / net / 串口库对象。sandbox 开启，因此以 CJS 输出
 * （由 apps/web/vite.config.ts 的 vite-plugin-electron preload 配置保证）。
 */
import { contextBridge, ipcRenderer } from "electron";
import type {
  BatchReadRowPayload,
  HostDebugState,
  HostErrorMessage,
  HostEventMessage,
  HostRequestKind,
  HostResponseMessage,
  MamepHostApi,
  MamepHostEvent,
  OpenTextFileResponse,
  PluginContributionQueryResponse,
  PluginRpcPayload,
  PluginRuntimeLoadPayload,
  PluginRuntimeUnloadPayload,
  PluginStoreDataPayload,
  PluginStoreDataResponse,
  RegisterRowPayload,
  SaveTextFileResponse,
  SessionBatchReadResponse,
  SessionStateResponse,
  SessionTcpConnectPayload,
  ReadVerifySettingsPayload,
  WriteOutcomePayload,
  WorkspaceLoadResponse,
} from "@mamep2026/platform-api";
import {
  HOST_MESSAGE_PROTOCOL_VERSION,
  MAMEP_IPC_EVENT_CHANNEL,
  MAMEP_IPC_INVOKE_CHANNEL,
  fromErrorPayload,
} from "@mamep2026/platform-api";
import type { MamepError, PlatformCapabilities, Result } from "@mamep2026/domain";
import { ok } from "@mamep2026/domain";

let seq = 0;

function nextMessageId(): string {
  seq += 1;
  return `preload-${Date.now()}-${seq}`;
}

type InvokeResult<T> = { ok: true; value: T } | { ok: false; error: MamepError };

async function invoke<T>(
  kind: HostRequestKind,
  payload: Record<string, unknown>,
): Promise<InvokeResult<T>> {
  const response = (await ipcRenderer.invoke(MAMEP_IPC_INVOKE_CHANNEL, {
    protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
    type: "request",
    messageId: nextMessageId(),
    kind,
    payload,
  })) as HostResponseMessage | HostErrorMessage;
  if (response.type === "error") {
    return { ok: false, error: fromErrorPayload(response.payload) };
  }
  // 主进程已按 kind 白名单校验并构造响应，payload 结构由对应 kind 契约保证。
  return { ok: true, value: response.payload as T };
}

const api: MamepHostApi = {
  platform: "electron",
  getCapabilities(): Promise<Result<PlatformCapabilities>> {
    return invoke<PlatformCapabilities>("get-capabilities", {});
  },
  getAppVersion(): Promise<Result<string>> {
    return invoke<string>("get-app-version", {});
  },
  async copyTextToClipboard(text: string): Promise<Result<void>> {
    const result = await invoke<null>("copy-text-to-clipboard", { text });
    return result.ok ? ok(undefined) : result;
  },
  async readTextFromClipboard(): Promise<Result<string | null>> {
    const result = await invoke<string | null>("read-text-from-clipboard", {});
    if (!result.ok) return result;
    const text = result.value;
    return ok(text !== null && text.length > 0 ? text : null);
  },
  async selectSerialPort(portId: string): Promise<Result<null>> {
    const result = await invoke<null>("select-serial-port", { portId });
    return result;
  },
  /** 打开并连接主进程 TCP 会话（session-tcp-connect；Electron TCP 走主进程，2026-08-23）。 */
  async sessionTcpConnect(
    payload: SessionTcpConnectPayload,
  ): Promise<Result<null>> {
    const result = await invoke<null>("session-tcp-connect", {
      profile: payload.profile,
    });
    return result;
  },
  /** 保存文本文件（save-text-file，2026-08-28 通信日志 CSV 导出）：主进程弹保存对话框落盘。 */
  saveTextFile(options: {
    suggestedName: string;
    content: string;
    mimeType?: string;
  }): Promise<Result<SaveTextFileResponse>> {
    return invoke<SaveTextFileResponse>("save-text-file", {
      suggestedName: options.suggestedName,
      content: options.content,
      ...(options.mimeType !== undefined
        ? { mimeType: options.mimeType }
        : {}),
    });
  },
  /** 打开文件对话框并读取 UTF-8 文本（open-text-file，2026-08-29 工作区导入）。 */
  openTextFile(options?: {
    suggestedName?: string;
  }): Promise<Result<OpenTextFileResponse>> {
    return invoke<OpenTextFileResponse>("open-text-file", {
      ...(options?.suggestedName !== undefined
        ? { suggestedName: options.suggestedName }
        : {}),
    });
  },
  /** 加载主进程文件仓储工作区（workspace-load，2026-08-30，ADR-036）。 */
  workspaceLoad(): Promise<Result<WorkspaceLoadResponse>> {
    return invoke<WorkspaceLoadResponse>("workspace-load", {});
  },
  /** 保存工作区到主进程文件仓储（workspace-save，2026-08-30，ADR-036）。 */
  workspaceSave(content: string): Promise<Result<null>> {
    return invoke<null>("workspace-save", { content });
  },
  /** 清除主进程文件仓储（workspace-clear，2026-08-30，ADR-036）。 */
  workspaceClear(): Promise<Result<null>> {
    return invoke<null>("workspace-clear", {});
  },
  /** 加载插件存储（plugin-store-load，2026-08-30，ADR-038）。 */
  pluginStoreLoad(): Promise<Result<PluginStoreDataResponse>> {
    return invoke<PluginStoreDataResponse>("plugin-store-load", {});
  },
  /** 保存插件存储（plugin-store-save，2026-08-30，ADR-038）。 */
  pluginStoreSave(data: PluginStoreDataPayload): Promise<Result<null>> {
    return invoke<null>("plugin-store-save", { data });
  },
  // ---- 插件运行时桥（2026-08-31，ADR-039）：Phase A 主进程返回能力错误，契约就位。----
  pluginRuntimeLoad(payload: PluginRuntimeLoadPayload): Promise<Result<null>> {
    return invoke<null>("plugin-runtime-load", payload);
  },
  pluginRuntimeUnload(
    payload: PluginRuntimeUnloadPayload,
  ): Promise<Result<null>> {
    return invoke<null>("plugin-runtime-unload", payload);
  },
  pluginRpc(payload: PluginRpcPayload): Promise<Result<unknown>> {
    return invoke<unknown>("plugin-rpc", payload);
  },
  pluginContributionQuery(payload?: {
    pointId?: string;
  }): Promise<Result<PluginContributionQueryResponse>> {
    return invoke<PluginContributionQueryResponse>("plugin-contribution-query", {
      ...(payload?.pointId !== undefined ? { pointId: payload.pointId } : {}),
    });
  },
  // ---- 远程会话 RPC（Electron TCP 会话在主进程，Renderer 远程代理）----
  sessionDisconnect(): Promise<Result<null>> {
    return invoke<null>("session-disconnect", {});
  },
  sessionGetState(): Promise<Result<SessionStateResponse>> {
    return invoke<SessionStateResponse>("session-get-state", {});
  },
  sessionSetUnitId(unitId: number): Promise<Result<null>> {
    return invoke<null>("session-set-unit-id", { unitId });
  },
  sessionReadRow(row: RegisterRowPayload): Promise<Result<number>> {
    return invoke<number>("session-read-row", { row });
  },
  sessionWriteRow(
    row: RegisterRowPayload,
    writeVerify?: ReadVerifySettingsPayload,
  ): Promise<Result<WriteOutcomePayload>> {
    return invoke<WriteOutcomePayload>("session-write-row", {
      row,
      ...(writeVerify !== undefined ? { writeVerify } : {}),
    });
  },
  sessionBatchRead(
    batchId: string,
    rows: BatchReadRowPayload[],
  ): Promise<Result<SessionBatchReadResponse>> {
    return invoke<SessionBatchReadResponse>("session-batch-read", {
      batchId,
      rows,
    });
  },
  sessionBatchCancel(batchId: string): Promise<Result<null>> {
    return invoke<null>("session-batch-cancel", { batchId });
  },
  sessionUpdatePollingTargets(
    rows: Array<{ key: string; address: number }>,
  ): Promise<Result<null>> {
    return invoke<null>("session-update-polling-targets", { rows });
  },
  sessionPollingStart(): Promise<Result<null>> {
    return invoke<null>("session-polling-start", {});
  },
  sessionPollingStop(): Promise<Result<null>> {
    return invoke<null>("session-polling-stop", {});
  },
  sessionTraceStart(
    key: string,
    address: number,
    speedMs: number,
  ): Promise<Result<null>> {
    return invoke<null>("session-trace-start", { key, address, speedMs });
  },
  sessionTraceStop(key: string): Promise<Result<null>> {
    return invoke<null>("session-trace-stop", { key });
  },
  getDebugState(): Promise<Result<HostDebugState | null>> {
    return invoke<HostDebugState | null>("debug:get-state", {});
  },
  onEvent(listener: (event: MamepHostEvent) => void): () => void {
    const handler = (_event: unknown, raw: unknown): void => {
      const message = raw as HostEventMessage;
      if (message.type !== "event") return;
      listener({ kind: message.kind, payload: message.payload });
    };
    ipcRenderer.on(MAMEP_IPC_EVENT_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(MAMEP_IPC_EVENT_CHANNEL, handler);
    };
  },
};

contextBridge.exposeInMainWorld("mamepHost", api);
