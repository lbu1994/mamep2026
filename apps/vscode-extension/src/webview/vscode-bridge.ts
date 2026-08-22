/**
 * VSCode Webview 侧消息桥（docs/TECH_DESIGN.md §6.3、§22.2、docs/AGENTS.md §23）。
 * 在 Webview 中设置 window.mamepHost（VscodeHostApi）：经 acquireVsCodeApi().postMessage
 * 与扩展宿主通信——request 由宿主 handleVscodeInvoke 校验并返回 response/error；
 * 宿主推送 event 经 window "message" 事件投递。
 * 复用 packages/platform-api 的 HostMessage v1 契约（Envelope + Zod parseHostMessage +
 * fromErrorPayload）。只暴露白名单方法，不暴露任意 acquireVsCodeApi 原始能力。
 */
import { fail } from "@mamep2026/domain";
import type { PlatformCapabilities, Result } from "@mamep2026/domain";
import type {
  ColorThemeKind,
  HostRequestKind,
  MamepHostEvent,
  VscodeHostApi,
  VscodeHostDebugState,
} from "@mamep2026/platform-api";
import {
  HOST_MESSAGE_PROTOCOL_VERSION,
  fromErrorPayload,
  parseHostMessage,
  type HostRequestMessage,
} from "@mamep2026/platform-api";

/** Webview 环境提供的 vsCodeApi（VSCode 注入；本模块不暴露给外部）。 */
export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

/** Webview 全局（由 VSCode 注入，非 Node 环境；此处仅声明类型）。 */
declare function acquireVsCodeApi(): VsCodeApi;

declare global {
  interface Window {
    /** VSCode Webview 桥（vscode-bridge.js 设置；App.tsx 据此分支装配 VscodeAppHost）。 */
    mamepHost?: VscodeHostApi;
  }
}

/**
 * 创建 VSCode Webview 桥（可测：注入 api 与 targetWindow）。
 * 返回满足 VscodeHostApi 的白名单对象，供 window.mamepHost 使用。
 */
export function createVscodeBridge(
  api: VsCodeApi,
  targetWindow: Window = window,
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

  targetWindow.addEventListener("message", (event: MessageEvent) => {
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
    onEvent: (listener: (event: MamepHostEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// 顶层：Webview 中执行时暴露 window.mamepHost（vscode-bridge.js 由扩展在 module script
// 之前注入的经典脚本，同步执行，先于共享 UI 就绪）。
if (typeof window !== "undefined" && typeof acquireVsCodeApi === "function") {
  window.mamepHost = createVscodeBridge(acquireVsCodeApi());
}
