/**
 * 跨边界 Host 消息协议 v1（docs/TECH_DESIGN.md §22.2、docs/AGENTS.md §23）。
 * Electron（及后续 VSCode Webview）的跨边界消息必须使用版本化 Envelope：
 * protocolVersion / messageId / type / kind / payload；payload 用 Zod 校验，
 * 未知 kind 被拒绝，不允许任意方法名调用。消息协议版本独立于应用/插件/工作区版本。
 */
import { z } from "zod";
import type {
  MamepError,
  PlatformCapabilities,
  Result,
} from "@mamep2026/domain";
import { createMamepError, fail, ok } from "@mamep2026/domain";
import type { ConnectionState } from "@mamep2026/communication";
import {
  connectionConfigFileSchema,
} from "@mamep2026/connection-config";
import {
  appMessagePayloadSchema,
  batchReadSummaryPayloadSchema,
  commLogEventPayloadSchema,
  registerRowPayloadSchema,
  rtuConnectionProfilePayloadSchema,
  sessionBatchCancelPayloadSchema,
  sessionBatchReadPayloadSchema,
  sessionTcpConnectPayloadSchema,
  sessionWriteRowPayloadSchema,
  traceSamplePayloadSchema,
  type BatchReadRowPayload,
  type ReadVerifySettingsPayload,
  type RegisterRowPayload,
  type SessionTcpConnectPayload,
  type WriteOutcomePayload,
} from "./session-payloads";

/** 消息协议版本：与 appVersion / 插件 apiVersion / 工作区 schemaVersion 相互独立。 */
export const HOST_MESSAGE_PROTOCOL_VERSION = 1 as const;

/** Electron IPC 频道：invoke（request/response/error）与 event 分开。 */
export const MAMEP_IPC_INVOKE_CHANNEL = "mamep:invoke";
export const MAMEP_IPC_EVENT_CHANNEL = "mamep:event";

/** request kind 白名单：主进程只处理这些 kind，其余一律拒绝。 */
export const HOST_REQUEST_KINDS = [
  "get-capabilities",
  "get-app-version",
  "copy-text-to-clipboard",
  "read-text-from-clipboard",
  "select-serial-port",
  "get-color-theme",
  "debug:get-state",
  // VSCode RTU 接线（2026-08-23）：串口枚举 + 远程会话命令。
  "serial-enumerate",
  "session-connect",
  "session-disconnect",
  "session-get-state",
  "session-set-slave-address",
  "session-set-unit-id",
  "session-read-row",
  "session-write-row",
  "session-batch-read",
  "session-batch-cancel",
  "session-update-polling-targets",
  "session-polling-start",
  "session-polling-stop",
  "session-trace-start",
  "session-trace-stop",
  // 两端 TCP 接线（2026-08-23）：TCP 会话连接（无串口句柄，profile 即参数）。
  "session-tcp-connect",
  // 连接对象配置文件（ADR-023）：桌面端从文件系统加载 config/connections.json（payload 空）。
  "connection-config-load",
  // 通信日志 CSV 导出（2026-08-28，PRD §8.3 P1）：把序列化好的 CSV 文本落盘/触发下载。
  "save-text-file",
] as const;
export type HostRequestKind = (typeof HOST_REQUEST_KINDS)[number];

/** event kind 白名单。 */
export const HOST_EVENT_KINDS = [
  "connection-state",
  "serial-ports-available",
  "color-theme-changed",
  // VSCode RTU 接线（2026-08-23）：远程会话事件推送。
  "comm-log",
  "poll-result",
  "trace-sample",
  "app-message",
] as const;
export type HostEventKind = (typeof HOST_EVENT_KINDS)[number];

/** 串口选项（Electron enumerated：主进程 select-serial-port 转发的可序列化端口列表项）。 */
export const serialPortOptionSchema = z.object({
  portId: z.string(),
  label: z.string(),
});
export type SerialPortOption = z.infer<typeof serialPortOptionSchema>;

/** 宿主颜色主题（UI 侧映射为 antd light/dark；高对比度由宿主映射为 dark）。 */
export const colorThemeSchema = z.enum(["light", "dark"]);
export type ColorThemeKind = z.infer<typeof colorThemeSchema>;

export type HostMessageType = "request" | "response" | "event" | "error";

const protocolVersionSchema = z.literal(HOST_MESSAGE_PROTOCOL_VERSION);
const messageIdSchema = z.string().min(1);
const requestKindSchema = z.enum(HOST_REQUEST_KINDS);
const errorCategorySchema = z.enum([
  "validation",
  "capability",
  "permission",
  "connection",
  "transport",
  "timeout",
  "protocol",
  "modbus-exception",
  "cancellation",
  "persistence",
  "plugin",
  "internal",
]);
const errorSeveritySchema = z.enum(["info", "warning", "error", "fatal"]);
const connectionStateSchema = z.enum([
  "disconnected",
  "selecting-device",
  "connecting",
  "connected",
  "disconnecting",
  "reconnect-waiting",
  "reconnecting",
  "interrupted",
  "failed",
]);

/** 错误可序列化投影：跨进程传输 MamepError 的结构化字段（不含 cause/context 等本地对象）。 */
export const hostErrorPayloadSchema = z.object({
  code: z.string(),
  category: errorCategorySchema,
  severity: errorSeveritySchema,
  retryable: z.boolean(),
  userMessageKey: z.string(),
  technicalMessage: z.string(),
});
export type HostErrorPayload = z.infer<typeof hostErrorPayloadSchema>;

export function toErrorPayload(error: MamepError): HostErrorPayload {
  return {
    code: error.code,
    category: error.category,
    severity: error.severity,
    retryable: error.retryable,
    userMessageKey: error.userMessageKey,
    technicalMessage: error.technicalMessage,
  };
}

export function fromErrorPayload(payload: HostErrorPayload): MamepError {
  return createMamepError({
    code: payload.code,
    category: payload.category,
    severity: payload.severity,
    retryable: payload.retryable,
    userMessageKey: payload.userMessageKey,
    technicalMessage: payload.technicalMessage,
  });
}

/** Result<number | number[]> 可序列化投影（事件载荷用，如 poll-result；多寄存器 ADR-030）。 */
export const hostResultPayloadSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.union([z.number(), z.array(z.number())]),
  }),
  z.object({ ok: z.literal(false), error: hostErrorPayloadSchema }),
]);
export type HostResultPayload = z.infer<typeof hostResultPayloadSchema>;

export function toResultPayload(
  result: Result<number | number[]>,
): HostResultPayload {
  return result.ok
    ? { ok: true, value: result.value }
    : { ok: false, error: toErrorPayload(result.error) };
}

export function fromResultPayload(
  payload: HostResultPayload,
): Result<number | number[]> {
  return payload.ok ? ok(payload.value) : fail(fromErrorPayload(payload.error));
}

/** session-connect 载荷。 */
export const sessionConnectPayloadSchema = z.object({
  portId: z.string(),
  profile: rtuConnectionProfilePayloadSchema,
  slaveAddress: z.number(),
});
export type SessionConnectPayload = z.infer<typeof sessionConnectPayloadSchema>;

/** session-get-state 响应载荷。 */
export const sessionStateResponseSchema = z.object({
  connectionState: connectionStateSchema,
});
export type SessionStateResponse = z.infer<typeof sessionStateResponseSchema>;

/** session-batch-read 响应载荷：仅汇总（每行结果经 poll-result 事件流推送）。 */
export const sessionBatchReadResponseSchema = z.object({
  summary: batchReadSummaryPayloadSchema,
});
export type SessionBatchReadResponse = z.infer<
  typeof sessionBatchReadResponseSchema
>;

/**
 * connection-config-load 响应载荷（ADR-023）：桌面端从文件系统读取外部连接对象配置。
 * config 为 null 表示未找到配置文件（可选能力，非错误）；sourcePath 为实际读取路径（诊断用）。
 * 校验失败 / 读取失败经 HostMessage error 通道返回 MamepError。
 */
export const connectionConfigLoadResponseSchema = z.object({
  config: connectionConfigFileSchema.nullable(),
  sourcePath: z.string().nullable(),
});
export type ConnectionConfigLoadResponse = z.infer<
  typeof connectionConfigLoadResponseSchema
>;

/**
 * save-text-file 响应载荷（2026-08-28，PRD §8.3 P1 日志导出）。
 * saved=false 表示用户取消保存对话框（非错误，UI 提示「已取消」）；filePath 为实际落盘路径（诊断用，
 * 浏览器下载无路径返回 null）。
 */
export const saveTextFileResponseSchema = z.object({
  saved: z.boolean(),
  filePath: z.string().nullable(),
});
export type SaveTextFileResponse = z.infer<typeof saveTextFileResponseSchema>;

const requestBase = {
  protocolVersion: protocolVersionSchema,
  type: z.literal("request"),
  messageId: messageIdSchema,
};

export const hostRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    ...requestBase,
    kind: z.literal("get-capabilities"),
    payload: z.object({}),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("get-app-version"),
    payload: z.object({}),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("copy-text-to-clipboard"),
    payload: z.object({ text: z.string() }),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("read-text-from-clipboard"),
    payload: z.object({}),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("select-serial-port"),
    // 渲染进程回传串口选择结果；空串 = 用户取消（对应主进程 callback("")）。
    payload: z.object({ portId: z.string() }),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("get-color-theme"),
    // VSCode 端骨架：查询当前颜色主题（get-color-theme request kind，2026-08-23）。
    payload: z.object({}),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("debug:get-state"),
    payload: z.object({}),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("serial-enumerate"),
    // VSCode：Extension Host 直接枚举系统串口（无浏览器授权手势约束）。
    payload: z.object({}),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("session-connect"),
    payload: sessionConnectPayloadSchema,
  }),
  z.object({
    ...requestBase,
    kind: z.literal("session-disconnect"),
    payload: z.object({}),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("session-get-state"),
    payload: z.object({}),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("session-set-slave-address"),
    payload: z.object({ slave: z.number() }),
  }),
  z.object({
    ...requestBase,
    // TCP Unit ID 会话内动态修改（2026-08-25）：渲染端按活动协议路由，TCP 走本 kind。
    kind: z.literal("session-set-unit-id"),
    payload: z.object({ unitId: z.number() }),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("session-read-row"),
    payload: z.object({ row: registerRowPayloadSchema }),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("session-write-row"),
    // 写后回读（2026-08-26）：payload 可携带每表 writeVerify 配置。
    payload: sessionWriteRowPayloadSchema,
  }),
  z.object({
    ...requestBase,
    kind: z.literal("session-batch-read"),
    // 远程批任务（ADR-025）：batchId 由渲染端生成，供 session-batch-cancel 关联取消。
    payload: sessionBatchReadPayloadSchema,
  }),
  z.object({
    ...requestBase,
    kind: z.literal("session-batch-cancel"),
    // 远程批任务取消（ADR-025）：按 batchId 取消活动批任务（未知 id 为安全 no-op）。
    payload: sessionBatchCancelPayloadSchema,
  }),
  z.object({
    ...requestBase,
    kind: z.literal("session-update-polling-targets"),
    payload: z.object({
      rows: z.array(
        z.object({
          key: z.string(),
          address: z.number(),
          /** 覆盖的连续寄存器数（ADR-030）：缺省/1=单寄存器。 */
          quantity: z.number().int().min(1).optional(),
        }),
      ),
    }),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("session-polling-start"),
    payload: z.object({}),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("session-polling-stop"),
    payload: z.object({}),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("session-trace-start"),
    payload: z.object({
      key: z.string(),
      address: z.number(),
      speedMs: z.number(),
      /** 覆盖的连续寄存器数（ADR-030）：缺省/1=单寄存器。 */
      quantity: z.number().int().min(1).optional(),
    }),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("session-trace-stop"),
    payload: z.object({ key: z.string() }),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("session-tcp-connect"),
    // 两端 TCP 接线（2026-08-23）：profile 即完整连接参数（host/port/unitId/超时/重试）。
    payload: sessionTcpConnectPayloadSchema,
  }),
  z.object({
    ...requestBase,
    kind: z.literal("connection-config-load"),
    // 连接对象配置文件加载（ADR-023）：无参数，平台侧按默认路径策略查找。
    payload: z.object({}),
  }),
  z.object({
    ...requestBase,
    kind: z.literal("save-text-file"),
    // 通信日志 CSV 导出（2026-08-28）：渲染端序列化好的 CSV 文本 + 建议文件名；落盘由平台侧完成。
    payload: z.object({
      suggestedName: z.string().min(1),
      content: z.string(),
      mimeType: z.string().optional(),
    }),
  }),
]);
export type HostRequestMessage = z.infer<typeof hostRequestSchema>;

export const hostResponseSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal("response"),
  messageId: messageIdSchema,
  kind: requestKindSchema,
  ok: z.literal(true),
  payload: z.unknown(),
});
export type HostResponseMessage = z.infer<typeof hostResponseSchema>;

export const hostErrorSchema = z.object({
  protocolVersion: protocolVersionSchema,
  type: z.literal("error"),
  messageId: messageIdSchema,
  // 错误响应由本协议实现方生成，kind 仅作诊断信息，不参与白名单分发。
  kind: z.string(),
  payload: hostErrorPayloadSchema,
});
export type HostErrorMessage = z.infer<typeof hostErrorSchema>;

export const hostEventSchema = z.discriminatedUnion("kind", [
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal("event"),
    messageId: messageIdSchema,
    kind: z.literal("connection-state"),
    payload: z.object({ state: connectionStateSchema }),
  }),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal("event"),
    messageId: messageIdSchema,
    kind: z.literal("serial-ports-available"),
    // 主进程 select-serial-port 事件转发的可用端口列表（供渲染进程下拉框展示）。
    payload: z.object({ ports: z.array(serialPortOptionSchema) }),
  }),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal("event"),
    messageId: messageIdSchema,
    kind: z.literal("color-theme-changed"),
    // 宿主颜色主题变化（VSCode 端骨架：扩展侧读 activeColorTheme 推送；UI 映射为 antd 主题）。
    payload: z.object({ theme: colorThemeSchema }),
  }),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal("event"),
    messageId: messageIdSchema,
    kind: z.literal("comm-log"),
    // 远程会话通信日志（bytes 以 hex 传输，Renderer 还原 Uint8Array）。
    payload: z.object({ event: commLogEventPayloadSchema }),
  }),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal("event"),
    messageId: messageIdSchema,
    kind: z.literal("poll-result"),
    payload: z.object({
      key: z.string(),
      address: z.number(),
      result: hostResultPayloadSchema,
    }),
  }),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal("event"),
    messageId: messageIdSchema,
    kind: z.literal("trace-sample"),
    payload: z.object({ sample: traceSamplePayloadSchema }),
  }),
  z.object({
    protocolVersion: protocolVersionSchema,
    type: z.literal("event"),
    messageId: messageIdSchema,
    kind: z.literal("app-message"),
    // 主机侧应用消息（如设备拔出）回灌 Renderer 的 messageStore。
    payload: z.object({ message: appMessagePayloadSchema }),
  }),
]);
export type HostEventMessage = z.infer<typeof hostEventSchema>;

export type HostMessage =
  | HostRequestMessage
  | HostResponseMessage
  | HostErrorMessage
  | HostEventMessage;

export const hostMessageSchema = z.union([
  hostRequestSchema,
  hostResponseSchema,
  hostErrorSchema,
  hostEventSchema,
]);

/** 校验跨边界消息；未知 kind / 类型 / 字段一律拒绝。 */
export function parseHostMessage(input: unknown): Result<HostMessage> {
  const parsed = hostMessageSchema.safeParse(input);
  if (parsed.success) return ok(parsed.data);
  return fail(
    createMamepError({
      code: "HOST_MESSAGE_INVALID",
      category: "internal",
      userMessageKey: "errors.hostMessageInvalid",
      technicalMessage: `invalid host message: ${parsed.error.message}`,
    }),
  );
}

/** preload 通过 contextBridge 转发给渲染进程的已解析事件。 */
export interface MamepHostEvent {
  readonly kind: HostEventKind;
  readonly payload: unknown;
}

/**
 * 开发/测试探针：主进程内部状态快照（Playwright Electron E2E 用，打包后返回禁用错误）。
 * 仅用于诊断，不进入任何 UI 状态源。
 */
export interface HostDebugState {
  readonly platform: "electron";
  readonly appVersion: string;
  readonly packaged: boolean;
  readonly windowCount: number;
  readonly connectionState: ConnectionState;
  readonly uptimeMs: number;
}

/** preload 暴露给渲染进程的白名单桥（docs/TECH_DESIGN.md §22.1：不暴露通用 ipcRenderer）。 */
export interface MamepHostApi {
  /** 渲染进程据此识别运行于 Electron。 */
  readonly platform: "electron";
  getCapabilities(): Promise<Result<PlatformCapabilities>>;
  getAppVersion(): Promise<Result<string>>;
  copyTextToClipboard(text: string): Promise<Result<void>>;
  /** 系统剪贴板无文本时返回 ok(null)。 */
  readTextFromClipboard(): Promise<Result<string | null>>;
  /**
   * 回传串口选择结果给主进程（Electron enumerated）：portId 空串 = 用户取消
   * （对应主进程 select-serial-port callback("")）。成功返回 ok(null)。
   */
  selectSerialPort(portId: string): Promise<Result<null>>;
  /** 订阅主进程事件；返回取消订阅函数。 */
  onEvent(listener: (event: MamepHostEvent) => void): () => void;
  /** 开发/测试探针：主进程内部状态（生产构建返回 fail）。 */
  getDebugState(): Promise<Result<HostDebugState | null>>;
  /** 打开并连接主进程 TCP 会话（session-tcp-connect；Electron TCP 走主进程，2026-08-23）。 */
  sessionTcpConnect(payload: SessionTcpConnectPayload): Promise<Result<null>>;

  /**
   * 加载外部连接对象配置文件（connection-config-load，ADR-023）：
   * 桌面端从文件系统读取 config/connections.json（默认路径策略见平台侧实现）。
   * 未找到配置文件返回 ok({ config: null, sourcePath: null })；解析/读取失败返回 fail。
   */
  loadConnectionConfig(): Promise<Result<ConnectionConfigLoadResponse>>;
  /**
   * 保存文本文件（save-text-file，2026-08-28 通信日志 CSV 导出）：
   * 浏览器触发 Blob 下载；桌面端弹保存对话框落盘（用户取消返回 ok({ saved: false })）。
   */
  saveTextFile(options: {
    suggestedName: string;
    content: string;
    mimeType?: string;
  }): Promise<Result<SaveTextFileResponse>>;

  // ---- 远程会话 RPC（2026-08-23 两端 TCP 接线：Electron TCP 会话在主进程，Renderer 远程代理）----

  sessionDisconnect(): Promise<Result<null>>;
  /** 查询会话状态快照（session-get-state）。 */
  sessionGetState(): Promise<Result<SessionStateResponse>>;
  /** TCP Unit ID 会话内动态修改（session-set-unit-id，2026-08-25）：对后续请求生效。 */
  sessionSetUnitId(unitId: number): Promise<Result<null>>;
  /** 单行读（session-read-row）：经主进程统一调度器 FC03（多寄存器行返回 values[]，ADR-030）。 */
  sessionReadRow(row: RegisterRowPayload): Promise<Result<number | number[]>>;
  /** 单行写（session-write-row）：经主进程统一调度器 FC0x10；writeVerify 为每表写后回读配置（2026-08-26）。 */
  sessionWriteRow(
    row: RegisterRowPayload,
    writeVerify?: ReadVerifySettingsPayload,
  ): Promise<Result<WriteOutcomePayload>>;
  /** 全表读取（session-batch-read）：单次往返返回汇总 + 每行结果。 */
  sessionBatchRead(
    batchId: string,
    rows: BatchReadRowPayload[],
  ): Promise<Result<SessionBatchReadResponse>>;
  /** 取消远程批任务（session-batch-cancel，ADR-025）：未知 batchId 为安全 no-op。 */
  sessionBatchCancel(batchId: string): Promise<Result<null>>;
  sessionUpdatePollingTargets(
    rows: Array<{ key: string; address: number; quantity?: number }>,
  ): Promise<Result<null>>;
  sessionPollingStart(): Promise<Result<null>>;
  sessionPollingStop(): Promise<Result<null>>;
  sessionTraceStart(
    key: string,
    address: number,
    speedMs: number,
    quantity?: number,
  ): Promise<Result<null>>;
  sessionTraceStop(key: string): Promise<Result<null>>;
}

/** VSCode 端 dev 探针快照（打包构建返回禁用错误；仅诊断用，不进 UI 状态源）。 */
export interface VscodeHostDebugState {
  readonly platform: "vscode";
  readonly appVersion: string;
  readonly colorTheme: ColorThemeKind;
  readonly capabilities: PlatformCapabilities;
  /** 会话通信统计（dev/e2e 探针，2026-08-23）：comm-log request/response 帧计数。 */
  readonly sessionStats: {
    readonly requestFrames: number;
    readonly responseFrames: number;
  };
}

/**
 * VSCode Webview 侧白名单桥（vscode-bridge 暴露 window.mamepHost，docs/TECH_DESIGN.md §6.3）。
 * 独立于 MamepHostApi 声明（platform 判别值不同），与 MamepHostApi 组成可窄化的判别联合
 * （window.mamepHost: MamepHostApi | VscodeHostApi，App.tsx 按 platform 分支装配）。
 * selectSerialPort 仍保留契约，但骨架阶段由扩展宿主返回 capability 错误（能力矩阵如实声明）。
 */
export interface VscodeHostApi
  extends Omit<MamepHostApi, "platform" | "getDebugState"> {
  readonly platform: "vscode";
  /** 查询当前颜色主题（get-color-theme request kind）。 */
  getColorTheme(): Promise<Result<ColorThemeKind>>;
  /** 开发/测试探针：扩展宿主内部状态（生产构建返回 fail）。 */
  getDebugState(): Promise<Result<VscodeHostDebugState | null>>;

  // ---- VSCode RTU 接线（2026-08-23）：远程会话 RPC（HostMessage v1）----

  /** 枚举系统串口（serial-enumerate；VSCode 无浏览器授权手势约束，直接返回列表）。 */
  enumerateSerialPorts(): Promise<Result<SerialPortOption[]>>;
  /** 打开并连接远程 RTU 会话（session-connect；portId 为 serial-enumerate 返回的端口）。 */
  sessionConnect(payload: SessionConnectPayload): Promise<Result<null>>;
  sessionDisconnect(): Promise<Result<null>>;
  /** 查询会话状态快照（session-get-state）。 */
  sessionGetState(): Promise<Result<SessionStateResponse>>;
  sessionSetSlaveAddress(slave: number): Promise<Result<null>>;
  /** TCP Unit ID 会话内动态修改（session-set-unit-id，2026-08-25）：对后续请求生效。 */
  sessionSetUnitId(unitId: number): Promise<Result<null>>;
  /** 单行读（session-read-row）：经 Extension Host 统一调度器 FC03（多寄存器行返回 values[]，ADR-030）。 */
  sessionReadRow(row: RegisterRowPayload): Promise<Result<number | number[]>>;
  /** 单行写（session-write-row）：经 Extension Host 统一调度器 FC0x10；writeVerify 为每表写后回读配置（2026-08-26）。 */
  sessionWriteRow(
    row: RegisterRowPayload,
    writeVerify?: ReadVerifySettingsPayload,
  ): Promise<Result<WriteOutcomePayload>>;
  /** 全表读取（session-batch-read）：单次往返返回汇总 + 每行结果。 */
  sessionBatchRead(
    batchId: string,
    rows: BatchReadRowPayload[],
  ): Promise<Result<SessionBatchReadResponse>>;
  /** 取消远程批任务（session-batch-cancel，ADR-025）：未知 batchId 为安全 no-op。 */
  sessionBatchCancel(batchId: string): Promise<Result<null>>;
  sessionUpdatePollingTargets(
    rows: Array<{ key: string; address: number; quantity?: number }>,
  ): Promise<Result<null>>;
  sessionPollingStart(): Promise<Result<null>>;
  sessionPollingStop(): Promise<Result<null>>;
  sessionTraceStart(
    key: string,
    address: number,
    speedMs: number,
    quantity?: number,
  ): Promise<Result<null>>;
  sessionTraceStop(key: string): Promise<Result<null>>;
  /** 打开并连接远程 TCP 会话（session-tcp-connect；profile 即连接参数，无串口句柄）。 */
  sessionTcpConnect(payload: SessionTcpConnectPayload): Promise<Result<null>>;
}

/**
 * Electron 能力矩阵（ADR-017 扩展，2026-08-21；2026-08-23 TCP 接线）：MVP 串口仍经
 * Web Serial API（Renderer navigator.serial，serialPorts:"enumerated" 下拉选择）；
 * Modbus TCP 已接线——会话承载在主进程（Node TCP Adapter + TcpSessionHost），
 * Renderer 经 HostMessage v1 远程代理（modbusTcp:true）。
 */
export const electronCapabilities: PlatformCapabilities = Object.freeze({
  modbusRtu: true,
  modbusTcp: true,
  serialPorts: "enumerated",
  filesystem: "limited",
  nodePlugins: false,
  webPlugins: true,
  connectionConfig: "file",
  logExport: "save-dialog",
});

/**
 * VSCode 端能力矩阵（2026-08-23 TCP 接线后）：RTU 经 Extension Host Node Serial Adapter 打通
 * （modbusRtu:true、serialPorts:"enumerated"），Modbus TCP 经 Extension Host Node TCP Adapter
 * 打通（modbusTcp:true）；filesystem/nodePlugins 未实现维持如实声明（docs/AGENTS.md §32 ㉒）。
 */
export const vscodeCapabilities: PlatformCapabilities = Object.freeze({
  modbusRtu: true,
  modbusTcp: true,
  serialPorts: "enumerated",
  filesystem: "unsupported",
  nodePlugins: false,
  webPlugins: true,
  connectionConfig: "file",
  logExport: "save-dialog",
});
