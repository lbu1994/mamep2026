/**
 * VSCode 扩展宿主 RPC 处理核心（可测纯函数，docs/TECH_DESIGN.md §22.2、§22.4、docs/AGENTS.md §23）。
 * 与 vscode 运行时解耦：外部能力经 IpcDeps 注入，便于单测校验/分发/拒绝路径
 * （未知 kind、非法 payload、debug 探针生产禁用等）。
 * 复用 packages/platform-api 的 HostMessage v1 契约：Envelope + Zod 校验 + kind 白名单，
 * 不允许任意方法名调用；响应引用原 messageId；结构化错误投影。
 */
import { createMamepError } from "@mamep2026/domain";
import type { PlatformCapabilities } from "@mamep2026/domain";
import {
  HOST_MESSAGE_PROTOCOL_VERSION,
  hostRequestSchema,
  toErrorPayload,
  type ColorThemeKind,
  type HostErrorMessage,
  type HostRequestMessage,
  type HostResponseMessage,
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

/** 扩展宿主侧外部能力（extension.ts 装配真实实现，测试注入 fake）。 */
export interface IpcDeps {
  appVersion(): string;
  /** 当前能力矩阵（骨架阶段返回 vscodeCapabilities）。 */
  capabilities(): PlatformCapabilities;
  /** 当前颜色主题（VSCode ColorThemeKind 已映射为 light/dark）。 */
  colorTheme(): ColorThemeKind;
  /** 是否开发/测试运行（extensionMode Development；生产打包禁用探针）。 */
  isDev(): boolean;
  clipboardWriteText(text: string): Promise<void>;
  clipboardReadText(): Promise<string>;
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
        userMessageKey: "errors.hostMessageRejected",
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
    payload,
  };
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
      // 骨架阶段串口未实现（能力矩阵 serialPorts:"unsupported"，AGENTS.md §32 ㉒ 如实声明）。
      return errorEnvelope(
        message.messageId,
        "SERIAL_UNSUPPORTED",
        "serial is not supported in the VSCode skeleton",
        "capability",
      );
    case "get-color-theme":
      return okResponse(message, deps.colorTheme());
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
        } satisfies VscodeHostDebugState,
      );
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
