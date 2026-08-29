/**
 * VSCode 扩展宿主 RPC 处理核心（可测纯函数，docs/TECH_DESIGN.md §22.2、§22.4、docs/AGENTS.md §23）。
 * 与 vscode 运行时解耦：外部能力经 IpcDeps 注入，便于单测校验/分发/拒绝路径
 * （未知 kind、非法 payload、debug 探针生产禁用等）。
 * 复用 packages/platform-api 的 HostMessage v1 契约：Envelope + Zod 校验 + kind 白名单，
 * 不允许任意方法名调用；响应引用原 messageId；结构化错误投影。
 */
import { createMamepError, ok, type Result } from "@mamep2026/domain";
import type { PlatformCapabilities } from "@mamep2026/domain";
import type {
  BatchReadHandle,
  BatchReadRow,
  ConnectionState,
  WriteOutcome,
} from "@mamep2026/communication";
import type {
  RegisterRow,
  ReadVerifySettings,
  RtuConnectionProfile,
  TcpConnectionProfile,
} from "@mamep2026/domain";
import {
  HOST_MESSAGE_PROTOCOL_VERSION,
  hostRequestSchema,
  readVerifySettingsFromPayload,
  registerRowFromPayload,
  rtuConnectionProfileFromPayload,
  tcpConnectionProfileFromPayload,
  toBatchReadSummaryPayload,
  toErrorPayload,
  toWriteOutcomePayload,
  type ColorThemeKind,
  type HostErrorMessage,
  type HostRequestMessage,
  type HostResponseMessage,
  type OpenTextFileResponse,
  type SaveTextFileResponse,
  type SerialPortOption,
  type VscodeHostDebugState,
} from "@mamep2026/platform-api";

/** 错误响应 category（与 host-message.ts 的 errorCategorySchema 对齐）。 */
export type HostErrorCategory =
  | "validation"
  | "capability"
  | "permission"
  | "connection"
  | "transport"
  | "timeout"
  | "protocol"
  | "modbus-exception"
  | "cancellation"
  | "persistence"
  | "plugin"
  | "internal";

/**
 * VSCode Extension Host 侧 RTU 会话依赖面（领域导向，测试注入 fake；真实实现见 session-host.ts）。
 * ipc.ts 负责 payload ↔ 领域对象转换；本接口只暴露领域操作与领域 Result。
 */
export interface VscodeSessionLike {
  enumerateSerialPorts(): Promise<Result<SerialPortOption[]>>;
  connect(
    portId: string,
    profile: RtuConnectionProfile,
    slaveAddress: number,
  ): Promise<Result<void>>;
  /** TCP 连接（2026-08-23 两端 TCP 接线）：profile 即连接参数，无串口句柄。 */
  connectTcp(profile: TcpConnectionProfile): Promise<Result<void>>;
  disconnect(): Promise<Result<void>>;
  getConnectionState(): ConnectionState;
  setSlaveAddress(slave: number): void;
  /** TCP Unit ID 会话内动态修改（session-set-unit-id，2026-08-25）。 */
  setUnitId(unitId: number): void;
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

/** 扩展宿主侧外部能力（extension.ts 装配真实实现，测试注入 fake）。 */
export interface IpcDeps {
  appVersion(): string;
  /** 当前能力矩阵（骨架阶段返回 vscodeCapabilities）。 */
  capabilities(): PlatformCapabilities;
  /** 当前颜色主题（VSCode ColorThemeKind 已映射为 light/dark）。 */
  colorTheme(): ColorThemeKind;
  /** 是否开发/测试运行（extensionMode Development；生产打包禁用探针）。 */
  isDev(): boolean;
  /**
   * 断开假 TCP 设备当前客户端（dev/e2e 探针，2026-08-30 自动重连）：
   * 无运行中的假设备返回 false；仅 MAMEP_FAKE_TCP=1 时装配。
   */
  dropFakeTcpClients(): boolean;
  clipboardWriteText(text: string): Promise<void>;
  clipboardReadText(): Promise<string>;
  /** RTU 会话（VSCode 接线，Extension Host 侧，2026-08-23）。 */
  session: VscodeSessionLike;
  /**
   * 会话通信统计（dev/e2e 探针，2026-08-23）：comm-log request/response 帧计数。
   * 用于 e2e 断言一次读取恰好一次收发；生产构建不进入 UI 状态源。
   */
  sessionStats(): { requestFrames: number; responseFrames: number };
  /**
   * 保存文本文件（save-text-file，2026-08-28 通信日志 CSV 导出）：
   * Extension Host 弹保存对话框 + workspace.fs 落盘；用户取消返回 ok({ saved: false })。
   */
  saveTextFile(options: {
    suggestedName: string;
    content: string;
    mimeType?: string;
  }): Promise<Result<SaveTextFileResponse>>;
  /**
   * 打开文件对话框并读取 UTF-8 文本（open-text-file，2026-08-29 工作区导入）：
   * Extension Host 弹系统打开对话框 + workspace.fs 读取；用户取消返回 ok({ content: null })。
   */
  openTextFile(options?: {
    suggestedName?: string;
  }): Promise<Result<OpenTextFileResponse>>;
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
  category: HostErrorCategory = "internal",
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

/** 会话操作统一错误投影：Result 失败 → error Envelope；异常 → internal 错误。 */
async function sessionResult<T>(
  message: HostRequestMessage,
  run: () => Promise<Result<T>> | Result<T>,
): Promise<HostResponseMessage | HostErrorMessage> {
  try {
    const result = await run();
    if (!result.ok) {
      return errorEnvelope(
        message.messageId,
        result.error.code,
        result.error.technicalMessage,
        result.error.category,
        result.error.userMessageKey,
      );
    }
    return okResponse(message, result.value);
  } catch (cause) {
    return errorEnvelope(
      message.messageId,
      "SESSION_INTERNAL_ERROR",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/** 无返回值会话操作：异常投影为 internal 错误。 */
function sessionVoid(
  message: HostRequestMessage,
  run: () => void,
): HostResponseMessage | HostErrorMessage {
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

export async function handleVscodeRequest(
  message: HostRequestMessage,
  deps: IpcDeps,
): Promise<HostResponseMessage | HostErrorMessage> {
  switch (message.kind) {
    case "get-capabilities":
      return okResponse(message, deps.capabilities());
    case "get-app-version":
      return okResponse(message, deps.appVersion());
    case "copy-text-to-clipboard":
      try {
        await deps.clipboardWriteText(message.payload.text);
        return okResponse(message, null);
      } catch (cause) {
        return errorEnvelope(
          message.messageId,
          "CLIPBOARD_WRITE_FAILED",
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    case "read-text-from-clipboard":
      try {
        return okResponse(message, await deps.clipboardReadText());
      } catch (cause) {
        return errorEnvelope(
          message.messageId,
          "CLIPBOARD_READ_FAILED",
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    case "select-serial-port":
      // VSCode 不走 Electron 的授权选择流程（串口枚举直接返回列表，选择在 session-connect 完成）。
      return errorEnvelope(
        message.messageId,
        "SERIAL_UNSUPPORTED",
        "select-serial-port is not used on the VSCode platform (use serial-enumerate + session-connect)",
        "capability",
      );
    case "get-color-theme":
      return okResponse(message, deps.colorTheme());
    // ---- RTU 会话（VSCode 接线，2026-08-23）----
    case "serial-enumerate":
      return sessionResult(message, () => deps.session.enumerateSerialPorts());
    case "session-connect": {
      const { portId, profile, slaveAddress } = message.payload;
      return sessionResult(message, () =>
        deps.session.connect(
          portId,
          rtuConnectionProfileFromPayload(profile),
          slaveAddress,
        ),
      );
    }
    case "session-disconnect":
      return sessionResult(message, () => deps.session.disconnect());
    case "session-get-state":
      return sessionResult(message, () =>
        Promise.resolve({
          ok: true,
          value: { connectionState: deps.session.getConnectionState() },
        }),
      );
    case "session-set-slave-address":
      return sessionVoid(message, () =>
        deps.session.setSlaveAddress(message.payload.slave),
      );
    case "session-set-unit-id":
      // TCP Unit ID 会话内动态修改（2026-08-25）：渲染端按活动协议路由到本 kind。
      return sessionVoid(message, () =>
        deps.session.setUnitId(message.payload.unitId),
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
      return sessionVoid(message, () => deps.session.traceStop(message.payload.key));
    case "session-tcp-connect": {
      // 两端 TCP 接线（2026-08-23）：profile 即连接参数，无串口句柄。
      const { profile } = message.payload;
      return sessionResult(message, () =>
        deps.session.connectTcp(tcpConnectionProfileFromPayload(profile)),
      );
    }
    case "save-text-file":
      // 通信日志 CSV 导出（2026-08-28）：Extension Host 弹保存对话框 + workspace.fs 落盘。
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
      // 工作区导入（2026-08-29）：Extension Host 弹打开对话框读 UTF-8 文本（取消=ok({content:null})）。
      return sessionResult(message, () =>
        deps.openTextFile(
          message.payload.suggestedName !== undefined
            ? { suggestedName: message.payload.suggestedName }
            : undefined,
        ),
      );
    case "debug:get-state":
      // 开发/测试探针（e2e 用）：生产构建禁用。
      if (!deps.isDev()) {
        return errorEnvelope(
          message.messageId,
          "DEBUG_PROBE_DISABLED",
          "debug probe is disabled in production",
        );
      }
      return okResponse(
        message,
        {
          platform: "vscode",
          appVersion: deps.appVersion(),
          colorTheme: deps.colorTheme(),
          capabilities: deps.capabilities(),
          sessionStats: deps.sessionStats(),
        } satisfies VscodeHostDebugState,
      );
    case "debug:fake-tcp-drop":
      // 开发/测试探针（e2e 自动重连用）：生产构建禁用。
      if (!deps.isDev()) {
        return errorEnvelope(
          message.messageId,
          "DEBUG_PROBE_DISABLED",
          "debug probe is disabled in production",
        );
      }
      return okResponse(message, { dropped: deps.dropFakeTcpClients() });
    default: {
      // 穷尽性守卫：新增 request kind 而未处理时，此处编译报错。
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}

export async function handleVscodeInvoke(
  raw: unknown,
  deps: IpcDeps,
): Promise<HostResponseMessage | HostErrorMessage> {
  // Zod 校验 + kind 白名单：未知 kind / 非法 payload 一律拒绝（AGENTS.md §23）。
  const parsed = hostRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return errorEnvelope(
      extractMessageId(raw),
      "HOST_MESSAGE_INVALID",
      `invalid host request: ${parsed.error.message}`,
      "validation",
    );
  }
  return handleVscodeRequest(parsed.data, deps);
}
