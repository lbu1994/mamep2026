/**
 * 安全 IPC 处理核心（可测纯函数，docs/TECH_DESIGN.md §22.3、docs/AGENTS.md §23）。
 * 与 electron 运行时解耦：外部能力经 IpcDeps 注入，便于单测校验/分发/拒绝路径
 * （未知 kind、非法 payload、发送者校验、debug 探针打包禁用等）。
 */
import {
  createMamepError,
  fail,
  ok,
  type MamepError,
  type Result,
} from "@mamep2026/domain";
import type {
  ReadVerifySettings,
  RegisterRow,
  TcpConnectionProfile,
} from "@mamep2026/domain";
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
  type WorkspaceLoadResponse,
} from "@mamep2026/platform-api";
import { parseWorkspace, serializeWorkspace } from "@mamep2026/workspace";
import type { WorkspaceRepositoryPort } from "@mamep2026/workspace";
import type { PluginStorePort } from "@mamep2026/plugin-api";
import { PLUGIN_RUNTIME_NOT_AVAILABLE } from "@mamep2026/plugin-api";

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
  /**
   * 工作区文件仓储（workspace-load / workspace-save / workspace-clear，2026-08-30，ADR-036）：
   * 主进程应用数据目录版本化 JSON，实现 WorkspaceRepositoryPort（原子保存 + 备份恢复）。
   */
  workspace: WorkspaceRepositoryPort;
  /**
   * 插件存储（plugin-store-load / plugin-store-save，2026-08-30，ADR-038）：
   * 主进程 userData plugins.json，实现 PluginStorePort（原子保存 + 备份恢复）。
   */
  pluginStore: PluginStorePort;
  /**
   * 插件存储保存成功后触发宿主侧插件执行面同步（ADR-055，2026-09-12）：
   * 主进程重新加载「已启用 + same-process」插件，使插件贡献的同步能力
   * （codec / addressTransform）在主进程会话中生效。同步不阻塞保存响应。
   */
  onPluginStoreSaved?: (() => void) | undefined;
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
    // 不发给主进程；此处返回能力错误并满足穷尽守卫。
    // 表级 Address Adjust（2026-09-01，ADR-042）：Electron RTU 会话在 Renderer；TCP 无地址变换。----
    case "serial-enumerate":
    case "session-connect":
    case "session-set-slave-address":
    case "session-set-address-transform":
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
    case "workspace-load":
      // Electron 文件持久化（2026-08-30，ADR-036）：主进程文件仓储 load → 序列化 JSON 字符串。
      // recoveryInfo（2026-09-04，ADR-049）：旁路返回最近一次加载的恢复元数据（备份恢复等）。
      return sessionResult(message, async () => {
        const result = await deps.workspace.load();
        if (!result.ok) return result;
        return ok({
          content: serializeWorkspace(result.value),
          recoveryInfo: deps.workspace.getRecoveryInfo(),
        } satisfies WorkspaceLoadResponse);
      });
    case "workspace-save":
      // Electron 文件持久化（2026-08-30，ADR-036）：content 为序列化 JSON 字符串，
      // 先 JSON.parse + parseWorkspace 校验再原子落盘（非法 JSON = 校验错误）。
      return sessionResult(message, async () => {
        let data: unknown;
        try {
          data = JSON.parse(message.payload.content);
        } catch {
          return fail(
            createMamepError({
              code: "WORKSPACE_SCHEMA_INVALID",
              category: "persistence",
              severity: "error",
              retryable: false,
              userMessageKey: "errors.workspaceSchemaInvalid",
              technicalMessage: "workspace content is not valid JSON",
            }),
          );
        }
        const parsed = parseWorkspace(data);
        if (!parsed.ok) return parsed;
        return deps.workspace.save(parsed.value);
      });
    case "workspace-clear":
      // Electron 文件持久化（2026-08-30，ADR-036）：清除主文件与备份。
      return sessionResult(message, () => deps.workspace.clear());
    case "workspace-create-backup":
      // 崩溃后状态恢复（2026-09-04，ADR-049）：当前工作区文件轮转为 .bak（§19.1 createBackup）。
      return sessionResult(message, () => deps.workspace.createBackup());
    case "plugin-store-load":
      // 插件存储（2026-08-30，ADR-038）：返回已安装插件清单 + 启用状态（无文件 = 空数组）。
      return sessionResult(message, () => deps.pluginStore.load());
    case "plugin-store-save": {
      // 插件存储（2026-08-30，ADR-038）：载荷为结构化插件存储数据，主进程校验后原子落盘。
      const saved = await sessionResult(message, () =>
        deps.pluginStore.save(message.payload.data),
      );
      // 保存成功 → 同步宿主侧插件执行面（ADR-055）：宿主插件加载失败不影响保存结果
      // （错误仅记录到宿主日志 / 应用消息）。
      if (saved.type === "response") deps.onPluginStoreSaved?.();
      return saved;
    }
    case "plugin-runtime-load":
    case "plugin-runtime-unload":
    case "plugin-rpc":
    case "plugin-contribution-query":
      // 插件运行时桥（2026-08-31，ADR-039）：Phase A 不执行第三方代码（隔离机制 Phase F，
      // 另立 ADR），宿主侧如实返回 PLUGIN_RUNTIME_NOT_AVAILABLE 能力错误；契约与穷尽守卫先行。
      return errorEnvelope(
        message.messageId,
        PLUGIN_RUNTIME_NOT_AVAILABLE,
        `plugin runtime is not available in this build (kind=${message.kind})`,
        "plugin",
        "errors.pluginRuntimeNotAvailable",
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
      return okResponse(message, {
        platform: "electron",
        appVersion: deps.appVersion(),
        packaged: deps.isPackaged(),
        windowCount: deps.windowCount(),
        connectionState: deps.connectionState(),
        uptimeMs: deps.uptimeMs(),
      } satisfies HostDebugState);
    case "debug:fake-tcp-drop":
      // dev/e2e 探针（2026-08-30 自动重连）：Electron 的假 TCP 设备在测试进程内
      // （Playwright net server），不驻留主进程，故恒返回 dropped:false。
      return okResponse(message, { dropped: false });
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
