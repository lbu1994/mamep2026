/**
 * 安全 IPC 处理核心（可测纯函数，docs/TECH_DESIGN.md §22.3、docs/AGENTS.md §23）。
 * 与 electron 运行时解耦：外部能力经 IpcDeps 注入，便于单测校验/分发/拒绝路径
 * （未知 kind、非法 payload、发送者校验、debug 探针打包禁用等）。
 */
import { createMamepError, ok, type MamepError, type Result } from "@mamep2026/domain";
import type { ReadVerifySettings, RegisterRow, TcpConnectionProfile } from "@mamep2026/domain";
import type {
  BatchReadHandle,
  BatchReadRow,
  ConnectionState,
  WriteOutcome,
} from "@mamep2026/communication";
import {
  HOST_MESSAGE_PROTOCOL_VERSION,
  electronCapabilities,
  hostRequestSchema,
  readVerifySettingsFromPayload,
  registerRowFromPayload,
  tcpConnectionProfileFromPayload,
  toBatchReadSummaryPayload,
  toErrorPayload,
  toWriteOutcomePayload,
  type HostDebugState,
  type HostErrorMessage,
  type HostRequestMessage,
  type HostResponseMessage,
  type OpenTextFileResponse,
  type SaveTextFileResponse,
  type SessionStateResponse,
} from "@mamep2026/platform-api";

/** 主进程侧 TCP 会话能力（ElectronSessionHost 实现；测试注入 fake）。 */
export interface ElectronSessionLike {
  connectTcp(profile: TcpConnectionProfile): Promise<Result<void>>;
  disconnect(): Promise<Result<void>>;
  /** TCP Unit ID 会话内动态修改（session-set-unit-id，2026-08-25）。 */
  setUnitId(unitId: number): void;
  getConnectionState(): ConnectionState;
  readRow(row: RegisterRow): Promise<Result<number | number[]>>;
  writeRow(
    row: RegisterRow,
    options?: { writeVerify?: ReadVerifySettings },
  ): Promise<Result<WriteOutcome>>;
  readAllRows(rows: BatchReadRow[], batchId?: string): BatchReadHandle;
  /** 按 batchId 取消活动批任务（ADR-025）：未知 batchId 为安全 no-op。 */
  cancelBatch(batchId: string): void;
  updatePollingTargets(rows: Array<{ key: string; address: number }>): void;
  startPolling(): void;
  stopPolling(): void;
  traceStart(key: string, address: number, speedMs: number): void;
  traceStop(key: string): void;
  dispose(): Promise<void>;
}

/** 主进程侧外部能力（Main 装配真实实现，测试注入 fake）。 */
export interface IpcDeps {
  appVersion(): string;
  isPackaged(): boolean;
  windowCount(): number;
  connectionState(): ConnectionState;
  uptimeMs(): number;
  clipboardWriteText(text: string): void;
  clipboardReadText(): string;
  /**
   * 解析挂起的串口选择（serial-permissions 持有 select-serial-port callback）。
   * portId 空串 = 用户取消；sender 用于归属校验；返回是否成功解析。
   */
  resolveSerialPortSelection(portId: string, sender: unknown): boolean;
  /** TCP 会话（Electron 主进程承载，2026-08-23 两端 TCP 接线）。 */
  session: ElectronSessionLike;
  /**
   * 保存文本文件（save-text-file，2026-08-28 通信日志 CSV 导出）：
   * 主进程弹保存对话框落盘；用户取消返回 ok({ saved: false })。
   */
  saveTextFile(options: {
    suggestedName: string;
    content: string;
    mimeType?: string;
  }): Promise<Result<SaveTextFileResponse>>;
  /**
   * 打开文件对话框并读取 UTF-8 文本（open-text-file，2026-08-29 工作区导入）：
   * 主进程弹系统打开对话框；用户取消返回 ok({ content: null })（非错误）。
   */
  openTextFile(options?: {
    suggestedName?: string;
  }): Promise<Result<OpenTextFileResponse>>;
}

/** 会话 RPC 包装：run 返回 Result 并映射为 response/error Envelope。 */
async function sessionResult<T>(
  message: HostRequestMessage,
  run: () => Promise<Result<T>>,
): Promise<HostResponseMessage | HostErrorMessage> {
  try {
    const result = await run();
    if (result.ok) return okResponse(message, result.value);
    return errorEnvelope(
      message.messageId,
      result.error.code,
      result.error.technicalMessage,
      result.error.category,
      result.error.userMessageKey,
    );
  } catch (cause) {
    return errorEnvelope(
      message.messageId,
      "SESSION_INTERNAL_ERROR",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/** 会话 void 命令包装（轮询/追踪/目标更新等）。 */
async function sessionVoid(
  message: HostRequestMessage,
  run: () => void,
): Promise<HostResponseMessage | HostErrorMessage> {
  try {
    run();
    return okResponse(message, null);
  } catch (cause) {
    return errorEnvelope(
      message.messageId,
      "SESSION_INTERNAL_ERROR",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/** 尽力从无法解析的原始消息中提取 messageId（诊断用；解析失败时为空串）。 */
export function extractMessageId(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return "";
  const id = (raw as { messageId?: unknown }).messageId;
  return typeof id === "string" && id.length > 0 ? id : "";
}

export function errorEnvelope(
  messageId: string,
  code: string,
  technicalMessage: string,
  category: MamepError["category"] = "internal",
  userMessageKey = "errors.hostMessageRejected",
): HostErrorMessage {
  return {
    protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
    type: "error",
    messageId,
    kind: "host-error",
    payload: toErrorPayload(
      createMamepError({
        code,
        category,
        userMessageKey,
        technicalMessage,
      }),
    ),
  };
}

export function okResponse(
  message: HostRequestMessage,
  payload: unknown,
): HostResponseMessage {
  return {
    protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
    type: "response",
    messageId: message.messageId,
    kind: message.kind,
    ok: true,
    // 序列化边界：postMessage/IPC 结构化克隆会丢弃 undefined 属性，导致 response
    // 缺 payload 字段、接收端 zod 校验失败（Result<void> 的 value 即 undefined）。
    // 统一归一为 null（z.unknown() 接受），保证 envelope 始终可序列化。
    payload: payload === undefined ? null : payload,
  };
}

export async function handleRequest(
  message: HostRequestMessage,
  deps: IpcDeps,
  sender?: unknown,
): Promise<HostResponseMessage | HostErrorMessage> {
  switch (message.kind) {
    case "get-capabilities":
      return okResponse(message, electronCapabilities);
    case "get-app-version":
      return okResponse(message, deps.appVersion());
    case "copy-text-to-clipboard":
      deps.clipboardWriteText(message.payload.text);
      return okResponse(message, null);
    case "read-text-from-clipboard":
      return okResponse(message, deps.clipboardReadText());
    case "select-serial-port":
      // 渲染进程回传串口选择（空串 = 取消）：解析主进程挂起的 select-serial-port 请求。
      if (deps.resolveSerialPortSelection(message.payload.portId, sender)) {
        return okResponse(message, null);
      }
      return errorEnvelope(
        message.messageId,
        "SERIAL_PICKER_NOT_ACTIVE",
        "no pending serial port selection for this sender",
      );
    case "get-color-theme":
      // 共享协议新增 kind（VSCode 端骨架，2026-08-23）：Electron preload 不暴露该能力，
      // 此处仅满足穷尽守卫，返回能力错误（不改变既有行为）。
      return errorEnvelope(
        message.messageId,
        "COLOR_THEME_UNSUPPORTED",
        "color theme RPC is not supported on the Electron host",
      );
    // ---- RTU 会话 kind（2026-08-23）：Electron RTU 运行在 Renderer（Web Serial），
    // 不发给主进程；此处返回能力错误并满足穷尽守卫。----
    case "serial-enumerate":
    case "session-connect":
    case "session-set-slave-address":
      return errorEnvelope(
        message.messageId,
        "SESSION_NOT_AVAILABLE",
        "RTU session RPC runs in the renderer (Web Serial); not handled by the Electron main host",
      );
    // ---- TCP 会话（2026-08-23 两端 TCP 接线）：主进程 ElectronSessionHost 承载。----
    case "session-tcp-connect": {
      const { profile } = message.payload;
      return sessionResult(message, () =>
        deps.session.connectTcp(tcpConnectionProfileFromPayload(profile)),
      );
    }
    case "session-disconnect":
      return sessionResult(message, () => deps.session.disconnect());
    case "session-set-unit-id":
      // TCP Unit ID 会话内动态修改（2026-08-25）：Electron TCP 会话在主进程。
      return sessionVoid(message, () =>
        deps.session.setUnitId(message.payload.unitId),
      );
    case "session-get-state":
      return sessionResult(message, () =>
        Promise.resolve({
          ok: true,
          value: { connectionState: deps.session.getConnectionState() },
        } satisfies Result<SessionStateResponse>),
      );
    case "session-read-row": {
      const { row } = message.payload;
      return sessionResult(message, () =>
        deps.session.readRow(registerRowFromPayload(row)),
      );
    }
    case "session-write-row": {
      const { row, writeVerify } = message.payload;
      return sessionResult(message, async () => {
        const result = await deps.session.writeRow(
          registerRowFromPayload(row),
          writeVerify !== undefined
            ? { writeVerify: readVerifySettingsFromPayload(writeVerify) }
            : undefined,
        );
        return result.ok ? ok(toWriteOutcomePayload(result.value)) : result;
      });
    }
    case "session-batch-read": {
      const { batchId, rows } = message.payload;
      return sessionResult(message, async () => {
        const handle = deps.session.readAllRows(
          rows.map((r) => ({ key: r.key, address: r.address })),
          batchId,
        );
        const result = await handle.promise;
        return result.ok
          ? ok({ summary: toBatchReadSummaryPayload(result.value) })
          : result;
      });
    }
    case "session-batch-cancel":
      // 远程批任务取消（ADR-025）：按 batchId 取消活动批任务（未知 id 安全 no-op）。
      return sessionVoid(message, () =>
        deps.session.cancelBatch(message.payload.batchId),
      );
    case "session-update-polling-targets":
      return sessionVoid(message, () =>
        deps.session.updatePollingTargets(message.payload.rows),
      );
    case "session-polling-start":
      return sessionVoid(message, () => deps.session.startPolling());
    case "session-polling-stop":
      return sessionVoid(message, () => deps.session.stopPolling());
    case "session-trace-start":
      return sessionVoid(message, () =>
        deps.session.traceStart(
          message.payload.key,
          message.payload.address,
          message.payload.speedMs,
        ),
      );
    case "session-trace-stop":
      return sessionVoid(message, () =>
        deps.session.traceStop(message.payload.key),
      );
    case "save-text-file":
      // 通信日志 CSV 导出（2026-08-28）：主进程弹保存对话框落盘（取消=ok({saved:false})）。
      // 显式构造 payload：exactOptionalPropertyTypes 下 Zod 可选字段是 `?: T | undefined`。
      return sessionResult(message, () =>
        deps.saveTextFile({
          suggestedName: message.payload.suggestedName,
          content: message.payload.content,
          ...(message.payload.mimeType !== undefined
            ? { mimeType: message.payload.mimeType }
            : {}),
        }),
      );
    case "open-text-file":
      // 工作区导入（2026-08-29）：主进程弹打开对话框读 UTF-8 文本（取消=ok({content:null})）。
      return sessionResult(message, () =>
        deps.openTextFile(
          message.payload.suggestedName !== undefined
            ? { suggestedName: message.payload.suggestedName }
            : undefined,
        ),
      );
    case "debug:get-state":
      // 开发/测试探针（Playwright Electron E2E 用）：打包构建禁用。
      if (deps.isPackaged()) {
        return errorEnvelope(
          message.messageId,
          "DEBUG_PROBE_DISABLED",
          "debug probe is disabled in packaged builds",
        );
      }
      return okResponse(
        message,
        {
          platform: "electron",
          appVersion: deps.appVersion(),
          packaged: deps.isPackaged(),
          windowCount: deps.windowCount(),
          connectionState: deps.connectionState(),
          uptimeMs: deps.uptimeMs(),
        } satisfies HostDebugState,
      );
    default: {
      // 穷尽性守卫：新增 request kind 而未处理时，此处编译报错。
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}

export interface HandleInvokeOptions {
  /** 消息发送者是否为主窗口渲染进程（Main 侧在调用前判断）。 */
  isSenderMainWindow: boolean;
  /** 消息发送者 webContents（串口选择会话归属校验用；缺省时归属校验自然失败）。 */
  sender?: unknown;
  deps: IpcDeps;
}

export async function handleInvoke(
  raw: unknown,
  options: HandleInvokeOptions,
): Promise<HostResponseMessage | HostErrorMessage> {
  // 仅接受主窗口渲染进程的消息（防跨窗口/未知发送者）。
  if (!options.isSenderMainWindow) {
    return errorEnvelope(
      extractMessageId(raw),
      "HOST_MESSAGE_SENDER_REJECTED",
      "message sender is not the main window",
    );
  }
  // Zod 校验 + kind 白名单：未知 kind / 非法 payload 一律拒绝。
  const parsed = hostRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return errorEnvelope(
      extractMessageId(raw),
      "HOST_MESSAGE_INVALID",
      `invalid host request: ${parsed.error.message}`,
    );
  }
  return handleRequest(parsed.data, options.deps, options.sender);
}
