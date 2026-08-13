/**
 * 测试用 Fake Transport：手动注入响应帧/错误/关闭事件，记录发送帧。
 * 仅供测试引用，不通过包 index 导出。
 */
import type { MamepError, Result } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import type { TransportPort } from "../transport-port";

export class FakeTransport implements TransportPort {
  readonly kind = "fake" as const;
  opened = false;
  closed = false;
  sentFrames: Uint8Array[] = [];
  private dataListeners = new Set<(chunk: Uint8Array) => void>();
  private errorListeners = new Set<(error: MamepError) => void>();
  private closeListeners = new Set<() => void>();
  private failWrites = false;

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
    this.opened = true;
    return ok(undefined);
  }

  async close(): Promise<Result<void>> {
    this.closed = true;
    this.opened = false;
    for (const listener of this.closeListeners) listener();
    return ok(undefined);
  }

  async write(bytes: Uint8Array): Promise<Result<void>> {
    if (this.failWrites) {
      return fail({
        code: "TRANSPORT_WRITE_FAILED",
        category: "transport",
        severity: "error",
        retryable: true,
        userMessageKey: "errors.transportWriteFailed",
        technicalMessage: "write failed (test)",
      });
    }
    this.sentFrames.push(bytes);
    return ok(undefined);
  }

  isOpen(): boolean {
    return this.opened;
  }

  setFailWrites(value: boolean): void {
    this.failWrites = value;
  }

  /** 模拟设备回传字节。 */
  simulateData(bytes: Uint8Array): void {
    for (const listener of this.dataListeners) listener(bytes);
  }

  simulateError(error: MamepError): void {
    for (const listener of this.errorListeners) listener(error);
  }

  simulateClose(): void {
    this.opened = false;
    for (const listener of this.closeListeners) listener();
  }
}
