/**
 * Node Serial 传输适配器（docs/TECH_DESIGN.md §9.3、§34.3）。
 * 只处理打开/关闭/字节读写与事件；不理解 Modbus 或寄存器表（功能码/CRC/组帧归协议与会话层）。
 * 端口路径视为不透明字符串；关闭幂等；重复连接不泄漏监听器（§34.3.13）。
 */
import type { MamepError, Result } from "@mamep2026/domain";
import { createMamepError, fail, ok } from "@mamep2026/domain";
import type { TransportPort } from "@mamep2026/communication";
import type { SerialPortLike } from "./serial-port-like";
import { mapOpenError, mapSerialError } from "./error-mapping";

export class NodeSerialTransport implements TransportPort {
  readonly kind = "node-serial" as const;
  private openFlag = false;
  private closeEmitted = false;
  private readonly port: SerialPortLike;
  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: MamepError) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(port: SerialPortLike) {
    this.port = port;
    port.onData((chunk) => {
      if (!this.openFlag) return;
      if (chunk.length === 0) return;
      for (const listener of this.dataListeners) listener(chunk);
    });
    port.onError((error) => {
      if (!this.openFlag) return;
      const mapped = mapSerialError(error);
      for (const listener of this.errorListeners) listener(mapped);
    });
    port.onClose(() => this.emitClose());
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

  async open(): Promise<Result<void>> {
    if (this.openFlag) {
      return fail(
        createMamepError({
          code: "SERIAL_OPEN_FAILED",
          category: "transport",
          retryable: false,
          userMessageKey: "errors.serialOpenFailed",
          technicalMessage: "serial port is already open",
        }),
      );
    }
    try {
      await this.port.open();
      this.openFlag = true;
      this.closeEmitted = false;
      return ok(undefined);
    } catch (cause) {
      return fail(mapOpenError(cause));
    }
  }

  async close(): Promise<Result<void>> {
    this.openFlag = false;
    try {
      await this.port.close();
    } catch (cause) {
      const error = mapSerialError(cause);
      this.emitClose();
      return fail(error);
    }
    this.emitClose();
    return ok(undefined);
  }

  async write(bytes: Uint8Array): Promise<Result<void>> {
    if (!this.openFlag) {
      return fail(
        createMamepError({
          code: "TRANSPORT_NOT_OPEN",
          category: "transport",
          userMessageKey: "errors.transportNotOpen",
          technicalMessage: "serial port is not open",
        }),
      );
    }
    try {
      // resolve 仅表示已提交给库/OS 缓冲，不表示设备已响应（§34.3.8）。
      await this.port.write(bytes);
      return ok(undefined);
    } catch (cause) {
      return fail(mapSerialError(cause));
    }
  }

  isOpen(): boolean {
    return this.openFlag;
  }

  private emitClose(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    this.openFlag = false;
    for (const listener of this.closeListeners) listener();
  }
}
