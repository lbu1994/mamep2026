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
  "debug:get-state",
] as const;
export type HostRequestKind = (typeof HOST_REQUEST_KINDS)[number];

/** event kind 白名单。 */
export const HOST_EVENT_KINDS = [
  "connection-state",
  "serial-ports-available",
] as const;
export type HostEventKind = (typeof HOST_EVENT_KINDS)[number];

/** 串口选项（Electron enumerated：主进程 select-serial-port 转发的可序列化端口列表项）。 */
export const serialPortOptionSchema = z.object({
  portId: z.string(),
  label: z.string(),
});
export type SerialPortOption = z.infer<typeof serialPortOptionSchema>;

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
    kind: z.literal("debug:get-state"),
    payload: z.object({}),
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
}

/**
 * Electron 能力矩阵（ADR-017 扩展，2026-08-21）：MVP 串口仍经 Web Serial API
 * （Renderer navigator.serial），但主进程 select-serial-port 不再自动选第一个端口，
 * 而是转发端口列表给渲染进程、由用户在 antd Select 下拉框中选择（serialPorts:
 * "enumerated"，含刷新/取消/空态）；TCP 仍不支持（MVP 不做）。
 * 后续 Node Serial/TCP Adapter 落地后再翻转为系统枚举 / modbusTcp。
 */
export const electronCapabilities: PlatformCapabilities = Object.freeze({
  modbusRtu: true,
  modbusTcp: false,
  serialPorts: "enumerated",
  filesystem: "limited",
  nodePlugins: false,
  webPlugins: true,
});
