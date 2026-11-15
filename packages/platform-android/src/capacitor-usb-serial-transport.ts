/**
 * Capacitor USB 串口传输（`TransportPort`）。
 *
 * 与 `CapacitorTcpTransport` 同构（刻意保持两份可对照的实现，而非过早抽象）：
 * - 先注册桥事件再 open，避免首帧丢失；
 * - 回包一律经 Zod 校验，非法形状 → `BRIDGE_PAYLOAD_INVALID`；
 * - `close()` 幂等并移除桥监听；
 * - 未打开时写入 → `TRANSPORT_NOT_OPEN`。
 *
 * 帧边界、CRC、超时与重试全在共享 JS 层：原生只按**空闲窗口聚合**后投递字节。
 */
import type { MamepError, Result } from "@mamep2026/domain";
import { createMamepError, fail, ok } from "@mamep2026/domain";
import type { TransportPort } from "@mamep2026/communication";
import {
  bridgeClosedEventSchema,
  bridgeDataEventSchema,
  bridgeErrorEventSchema,
  bridgeWriteParamsSchema,
  buildBridgeParams,
  decodeBase64ToBytes,
  encodeBytesToBase64,
  parseBridgePayload,
  type BridgeOpenSerialParams,
} from "./bridge-contract";
import type { BridgeListenerHandle, MamepTransportBridge } from "./bridge";
import { mapAndroidNativeError, toNativeBridgeError } from "./error-mapping";

export interface CapacitorUsbSerialTransportOptions {
  bridge: MamepTransportBridge;
  /** 已由 `AndroidPlatformHost` 校验并映射好的打开参数。 */
  params: BridgeOpenSerialParams;
}

export class CapacitorUsbSerialTransport implements TransportPort {
  readonly kind = "capacitor-usb" as const;

  private readonly bridge: MamepTransportBridge;
  private readonly options: CapacitorUsbSerialTransportOptions;
  private opened = false;
  private closeEmitted = false;
  private bridgeHandles: BridgeListenerHandle[] = [];
  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: MamepError) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(options: CapacitorUsbSerialTransportOptions) {
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
    if (this.opened)
      return fail(serialOpenFailedError("serial port is already open"));

    const subscribed = await this.subscribeBridgeEvents();
    if (!subscribed.ok) return fail(subscribed.error);

    try {
      await this.bridge.openSerial(this.options.params);
    } catch (cause) {
      await this.removeBridgeListeners();
      return fail(
        mapAndroidNativeError(toNativeBridgeError(cause), "serial-open"),
      );
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
          technicalMessage: "android serial port is not open",
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
      return fail(
        mapAndroidNativeError(toNativeBridgeError(cause), "serial-io"),
      );
    }
  }

  async close(): Promise<Result<void>> {
    this.opened = false;
    await this.removeBridgeListeners();
    try {
      await this.bridge.close();
    } catch (cause) {
      const error = mapAndroidNativeError(
        toNativeBridgeError(cause),
        "serial-io",
      );
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
      return fail(
        mapAndroidNativeError(toNativeBridgeError(cause), "serial-open"),
      );
    }
  }

  private async removeBridgeListeners(): Promise<void> {
    const handles = this.bridgeHandles;
    this.bridgeHandles = [];
    for (const handle of handles) {
      try {
        await handle.remove();
      } catch {
        // 退订失败不影响会话状态（原生侧会随串口关闭清理）。
      }
    }
  }

  private handleDataEvent(payload: unknown): void {
    if (!this.opened) return;
    const parsed = parseBridgePayload(
      bridgeDataEventSchema,
      payload,
      "serial.data",
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
    const parsed = parseBridgePayload(
      bridgeClosedEventSchema,
      payload ?? {},
      "serial.closed",
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
      "serial.error",
    );
    if (!parsed.ok) {
      for (const listener of this.errorListeners) listener(parsed.error);
      return;
    }
    const error = mapAndroidNativeError(parsed.value, "serial-io");
    for (const listener of this.errorListeners) listener(error);
  }

  private emitClose(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    for (const listener of this.closeListeners) listener();
  }
}

function serialOpenFailedError(technicalMessage: string): MamepError {
  return createMamepError({
    code: "SERIAL_OPEN_FAILED",
    category: "transport",
    retryable: true,
    userMessageKey: "errors.serialOpenFailed",
    technicalMessage: `android serial open failed: ${technicalMessage}`,
  });
}
