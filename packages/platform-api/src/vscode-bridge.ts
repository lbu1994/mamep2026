/**
 * VSCode Webview 侧消息桥（docs/TECH_DESIGN.md §6.3、§22.2、docs/AGENTS.md §23）。
 * 在 Webview 中设置 window.mamepHost（VscodeHostApi）：经注入的 VsCodeApi.postMessage
 * 与扩展宿主通信——request 由宿主 handleVscodeInvoke 校验并返回 response/error；
 * 宿主推送 event 经 targetWindow "message" 事件投递。
 * 复用本包 HostMessage v1 契约（Envelope + Zod parseHostMessage + fromErrorPayload）。
 * 只暴露白名单方法，不暴露任意原始能力。
 *
 * 本模块只依赖 HostMessage v1 契约与注入的 vsCodeApi，不依赖 vscode 模块，可被三端复用：
 * - 生产（扩展 Webview 主 frame）：api = acquireVsCodeApi()（apps/vscode-extension/src/webview/vscode-bridge.ts）；
 * - dev（MAMEP_DEV_URL，webview 主 frame 以 iframe 加载 Vite dev server）：iframe 内应用侧
 *   用 window.parent.postMessage 构造的 api 创建同一桥（apps/web/src/vscode-dev-bridge.ts），
 *   主 frame 中继脚本在 iframe ↔ 扩展宿主之间转发 HostMessage Envelope。
 *
 * 注意：为避免本包（node 侧无 DOM lib）依赖 Window/MessageEvent 全局类型，消息接收目标
 * 用最小结构化类型 BridgeMessageTarget 表达（真实 window 满足该结构）。
 */
import { fail } from "@mamep2026/domain";
import type { PlatformCapabilities, Result } from "@mamep2026/domain";
import type {
  ColorThemeKind,
  HostRequestKind,
  MamepHostEvent,
  SerialPortOption,
  SessionBatchReadResponse,
  SessionConnectPayload,
  SessionStateResponse,
  VscodeHostApi,
  VscodeHostDebugState,
} from "./host-message";
import type {
  BatchReadRowPayload,
  RegisterRowPayload,
  SessionTcpConnectPayload,
  WriteOutcomePayload,
} from "./session-payloads";
import {
  HOST_MESSAGE_PROTOCOL_VERSION,
  fromErrorPayload,
  parseHostMessage,
  type HostRequestMessage,
} from "./host-message";

/** Webview 环境提供的消息通道（生产 = acquireVsCodeApi()；dev iframe = postMessage 封装）。 */
export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

/** 消息接收目标的最小结构（真实 Webview window 满足该结构；避免依赖 DOM lib）。 */
export interface BridgeMessageTarget {
  addEventListener(
    type: "message",
    listener: (event: BridgeMessageEvent) => void,
  ): void;
}

/** createVscodeBridge 收到的 message 事件最小形状（只用 data 与 source）。 */
export interface BridgeMessageEvent {
  data: unknown;
  source?: unknown;
}

/**
 * 创建 VSCode Webview 桥（可测：注入 api 与 targetWindow）。
 * 返回满足 VscodeHostApi 的白名单对象，供 window.mamepHost 使用。
 */
export function createVscodeBridge(
  api: VsCodeApi,
  targetWindow: BridgeMessageTarget,
): VscodeHostApi {
  const pending = new Map<string, (result: Result<unknown>) => void>();
  const listeners = new Set<(event: MamepHostEvent) => void>();
  let seq = 0;

  function nextMessageId(): string {
    seq += 1;
    return `vscode-${Date.now()}-${seq}`;
  }

  function postRequest<T>(
    kind: HostRequestKind,
    payload: Record<string, unknown>,
  ): Promise<Result<T>> {
    const messageId = nextMessageId();
    const envelope = {
      protocolVersion: HOST_MESSAGE_PROTOCOL_VERSION,
      type: "request",
      messageId,
      kind,
      payload,
    } as HostRequestMessage;
    const promise = new Promise<Result<T>>((resolve) => {
      // 响应 payload 结构由 kind 契约保证（hostResponseSchema payload: z.unknown()），
      // 边界处一次类型收窄，非蒙混。
      pending.set(messageId, (result) => {
        resolve(result as unknown as Result<T>);
      });
    });
    api.postMessage(envelope);
    return promise;
  }

  targetWindow.addEventListener("message", (event: BridgeMessageEvent) => {
    const parsed = parseHostMessage(event.data);
    if (!parsed.ok) return; // 非本协议消息（VSCode 自身消息等）一律忽略。
    const message = parsed.value;
    if (message.type === "response") {
      const resolve = pending.get(message.messageId);
      if (resolve !== undefined) {
        pending.delete(message.messageId);
        resolve({ ok: true, value: message.payload });
      }
      return;
    }
    if (message.type === "error") {
      const resolve = pending.get(message.messageId);
      if (resolve !== undefined) {
        pending.delete(message.messageId);
        resolve(fail(fromErrorPayload(message.payload)));
      }
      return;
    }
    if (message.type === "event") {
      const hostEvent: MamepHostEvent = {
        kind: message.kind,
        payload: message.payload,
      };
      for (const listener of listeners) listener(hostEvent);
    }
    // type === "request"：宿主不向 Webview 发 request（骨架阶段），忽略。
  });

  return {
    platform: "vscode",
    getCapabilities: () =>
      postRequest<PlatformCapabilities>("get-capabilities", {}),
    getAppVersion: () => postRequest<string>("get-app-version", {}),
    copyTextToClipboard: (text: string) =>
      postRequest<void>("copy-text-to-clipboard", { text }),
    readTextFromClipboard: () =>
      postRequest<string | null>("read-text-from-clipboard", {}),
    selectSerialPort: (portId: string) =>
      postRequest<null>("select-serial-port", { portId }),
    getColorTheme: () => postRequest<ColorThemeKind>("get-color-theme", {}),
    getDebugState: () =>
      postRequest<VscodeHostDebugState | null>("debug:get-state", {}),
    // ---- RTU 会话（VSCode 接线，2026-08-23）----
    enumerateSerialPorts: () =>
      postRequest<SerialPortOption[]>("serial-enumerate", {}),
    sessionConnect: (payload: SessionConnectPayload) =>
      postRequest<null>("session-connect", payload),
    sessionDisconnect: () => postRequest<null>("session-disconnect", {}),
    sessionGetState: () =>
      postRequest<SessionStateResponse>("session-get-state", {}),
    sessionSetSlaveAddress: (slave: number) =>
      postRequest<null>("session-set-slave-address", { slave }),
    sessionReadRow: (row: RegisterRowPayload) =>
      postRequest<number>("session-read-row", { row }),
    sessionWriteRow: (row: RegisterRowPayload) =>
      postRequest<WriteOutcomePayload>("session-write-row", { row }),
    sessionBatchRead: (rows: BatchReadRowPayload[]) =>
      postRequest<SessionBatchReadResponse>("session-batch-read", { rows }),
    sessionUpdatePollingTargets: (
      rows: Array<{ key: string; address: number }>,
    ) => postRequest<null>("session-update-polling-targets", { rows }),
    sessionPollingStart: () => postRequest<null>("session-polling-start", {}),
    sessionPollingStop: () => postRequest<null>("session-polling-stop", {}),
    sessionTraceStart: (key: string, address: number, speedMs: number) =>
      postRequest<null>("session-trace-start", { key, address, speedMs }),
    sessionTraceStop: (key: string) =>
      postRequest<null>("session-trace-stop", { key }),
    sessionTcpConnect: (payload: SessionTcpConnectPayload) =>
      postRequest<null>("session-tcp-connect", payload),
    onEvent: (listener: (event: MamepHostEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
