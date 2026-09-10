/**
 * Capacitor TCP 传输（`TransportPort`，ADR-050 §5）。
 *
 * 只处理「打开 / 写字节 / 来字节 / 关闭」：帧编码、CRC、MBAP 分帧、超时与重试全部留在 JS 共享层
 * （`packages/communication`），因此上层 `TcpSessionHost` 与三端完全同源。
 *
 * 契约要点：
 * - 先注册桥事件再 open，避免首帧丢失（与 session.ts「先注册数据监听，再写字节」同因）；
 * - 回包一律经 Zod 校验，非法形状 → `BRIDGE_PAYLOAD_INVALID`（不静默降级）；
 * - `close()` 幂等，且移除桥监听（避免重连累积监听器）；
 * - 未打开时写入 → `TRANSPORT_NOT_OPEN`。
 */
import type { MamepError, Result } from "@mamep2026/domain";
import { createMamepError, fail, ok } from "@mamep2026/domain";
import type { TransportPort } from "@mamep2026/communication";
import {
  bridgeClosedEventSchema,
  bridgeDataEventSchema,
  bridgeErrorEventSchema,
  bridgeOpenTcpParamsSchema,
  bridgeWriteParamsSchema,
  buildBridgeParams,
  decodeBase64ToBytes,
  encodeBytesToBase64,
  parseBridgePayload,
} from "./bridge-contract";
import type { BridgeListenerHandle, MamepTransportBridge } from "./bridge";
import { mapAndroidNativeError, toNativeBridgeError } from "./error-mapping";

export interface CapacitorTcpTransportOptions {
  bridge: MamepTransportBridge;
  host: string;
  port: number;
  /** 连接超时（来自 profile.connectTimeoutMs，由原生 socket connect 使用）。 */
  connectTimeoutMs: number;
}

export class CapacitorTcpTransport implements TransportPort {
  readonly kind = "capacitor-tcp" as const;

  private readonly bridge: MamepTransportBridge;
  private readonly options: CapacitorTcpTransportOptions;
  private opened = false;
  private closeEmitted = false;
  private bridgeHandles: BridgeListenerHandle[] = [];
  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: MamepError) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(options: CapacitorTcpTransportOptions) {
    this.bridge = options.bridge;
    this.options = options;
  }

  onData(listener: (chunk: Uint8Array) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onError(listener: (error: MamepError) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  isOpen(): boolean {
    return this.opened;
  }

  async open(): Promise<Result<void>> {
    if (this.opened) {
      return fail(
        createMamepError({
          code: "TCP_OPEN_FAILED",
          category: "transport",
          retryable: false,
          userMessageKey: "errors.tcpOpenFailed",
          technicalMessage: "tcp connection is already open",
        }),
      );
    }

    const params = buildBridgeParams(
      bridgeOpenTcpParamsSchema,
      {
        host: this.options.host,
        port: this.options.port,
        connectTimeoutMs: this.options.connectTimeoutMs,
      },
      "openTcp",
    );
    if (!params.ok) return fail(params.error);

    const subscribed = await this.subscribeBridgeEvents();
    if (!subscribed.ok) return fail(subscribed.error);

    try {
      await this.bridge.openTcp(params.value);
    } catch (cause) {
      await this.removeBridgeListeners();
      return fail(mapAndroidNativeError(toNativeBridgeError(cause), "open"));
    }

    this.opened = true;
    this.closeEmitted = false;
    return ok(undefined);
  }

  async write(bytes: Uint8Array): Promise<Result<void>> {
    if (!this.opened) {
      return fail(
        createMamepError({
          code: "TRANSPORT_NOT_OPEN",
          category: "transport",
          retryable: false,
          userMessageKey: "errors.transportNotOpen",
          technicalMessage: "android tcp connection is not open",
        }),
      );
    }
    const params = buildBridgeParams(
      bridgeWriteParamsSchema,
      { data: encodeBytesToBase64(bytes) },
      "write",
    );
    if (!params.ok) return fail(params.error);

    try {
      await this.bridge.write(params.value);
      return ok(undefined);
    } catch (cause) {
      return fail(mapAndroidNativeError(toNativeBridgeError(cause), "io"));
    }
  }

  async close(): Promise<Result<void>> {
    this.opened = false;
    await this.removeBridgeListeners();
    try {
      await this.bridge.close();
    } catch (cause) {
      const error = mapAndroidNativeError(toNativeBridgeError(cause), "io");
      this.emitClose();
      return fail(error);
    }
    this.emitClose();
    return ok(undefined);
  }

  private async subscribeBridgeEvents(): Promise<Result<void>> {
    try {
      this.bridgeHandles = [
        await this.bridge.addListener("data", (payload) =>
          this.handleDataEvent(payload),
        ),
        await this.bridge.addListener("closed", (payload) =>
          this.handleClosedEvent(payload),
        ),
        await this.bridge.addListener("error", (payload) =>
          this.handleErrorEvent(payload),
        ),
      ];
      return ok(undefined);
    } catch (cause) {
      await this.removeBridgeListeners();
      return fail(mapAndroidNativeError(toNativeBridgeError(cause), "open"));
    }
  }

  private async removeBridgeListeners(): Promise<void> {
    const handles = this.bridgeHandles;
    this.bridgeHandles = [];
    for (const handle of handles) {
      try {
        await handle.remove();
      } catch {
        // 退订失败不影响会话状态（原生侧会随连接关闭清理）。
      }
    }
  }

  private handleDataEvent(payload: unknown): void {
    if (!this.opened) return;
    const parsed = parseBridgePayload(
      bridgeDataEventSchema,
      payload,
      "transport.data",
    );
    if (!parsed.ok) {
      for (const listener of this.errorListeners) listener(parsed.error);
      return;
    }
    const decoded = decodeBase64ToBytes(parsed.value.data);
    if (!decoded.ok) {
      for (const listener of this.errorListeners) listener(decoded.error);
      return;
    }
    if (decoded.value.length === 0) return;
    for (const listener of this.dataListeners) listener(decoded.value);
  }

  private handleClosedEvent(payload: unknown): void {
    // closed 载荷可空（本地关闭时原生不保证带信息）；形状非法不阻塞关闭语义。
    const parsed = parseBridgePayload(
      bridgeClosedEventSchema,
      payload ?? {},
      "transport.closed",
    );
    if (!parsed.ok) {
      for (const listener of this.errorListeners) listener(parsed.error);
    }
    this.opened = false;
    this.emitClose();
  }

  private handleErrorEvent(payload: unknown): void {
    const parsed = parseBridgePayload(
      bridgeErrorEventSchema,
      payload,
      "transport.error",
    );
    if (!parsed.ok) {
      for (const listener of this.errorListeners) listener(parsed.error);
      return;
    }
    const error = mapAndroidNativeError(parsed.value, "io");
    for (const listener of this.errorListeners) listener(error);
  }

  private emitClose(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    for (const listener of this.closeListeners) listener();
  }
}
