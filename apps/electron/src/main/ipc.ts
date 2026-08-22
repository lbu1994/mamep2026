/**
 * 安全 IPC 处理核心（可测纯函数，docs/TECH_DESIGN.md §22.3、docs/AGENTS.md §23）。
 * 与 electron 运行时解耦：外部能力经 IpcDeps 注入，便于单测校验/分发/拒绝路径
 * （未知 kind、非法 payload、发送者校验、debug 探针打包禁用等）。
 */
import { createMamepError } from "@mamep2026/domain";
import type { ConnectionState } from "@mamep2026/communication";
import {
  HOST_MESSAGE_PROTOCOL_VERSION,
  electronCapabilities,
  hostRequestSchema,
  toErrorPayload,
  type HostDebugState,
  type HostErrorMessage,
  type HostRequestMessage,
  type HostResponseMessage,
} from "@mamep2026/platform-api";

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
): HostErrorMessage {
  return {
    protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
    type: "error",
    messageId,
    kind: "host-error",
    payload: toErrorPayload(
      createMamepError({
        code,
        category: "internal",
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

export function handleRequest(
  message: HostRequestMessage,
  deps: IpcDeps,
  sender?: unknown,
): HostResponseMessage | HostErrorMessage {
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

export function handleInvoke(
  raw: unknown,
  options: HandleInvokeOptions,
): HostResponseMessage | HostErrorMessage {
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
