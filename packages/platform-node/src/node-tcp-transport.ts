/**
 * Node TCP 传输适配器（docs/TECH_DESIGN.md §34.3.16 后续 Node TCP Adapter）。
 * 只处理打开/关闭/字节读写与事件；不理解 Modbus 或寄存器表（MBAP 组帧/分帧归协议与会话层）。
 * 关闭幂等；重复连接不泄漏监听器（§34.3.13）；错误经 mapTcpError 映射后上抛。
 */
import type { MamepError, Result } from "@mamep2026/domain";
import { createMamepError, fail, ok } from "@mamep2026/domain";
import type { TransportPort } from "@mamep2026/communication";
import type { SocketLike } from "./socket-like";
import { mapTcpError, mapTcpOpenError } from "./error-mapping";

export class NodeTcpTransport implements TransportPort {
  readonly kind = "node-tcp" as const;
  private openFlag = false;
  private closeEmitted = false;
  private readonly socket: SocketLike;
  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: MamepError) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(socket: SocketLike) {
    this.socket = socket;
    socket.onData((chunk) => {
      if (!this.openFlag) return;
      if (chunk.length === 0) return;
      for (const listener of this.dataListeners) listener(chunk);
    });
    socket.onError((error) => {
      if (!this.openFlag) return;
      const mapped = mapTcpError(error);
      for (const listener of this.errorListeners) listener(mapped);
    });
    socket.onClose(() => this.emitClose());
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
          code: "TCP_OPEN_FAILED",
          category: "transport",
          retryable: false,
          userMessageKey: "errors.tcpOpenFailed",
          technicalMessage: "tcp connection is already open",
        }),
      );
    }
    try {
      await this.socket.open();
      this.openFlag = true;
      this.closeEmitted = false;
      return ok(undefined);
    } catch (cause) {
      return fail(mapTcpOpenError(cause));
    }
  }

  async close(): Promise<Result<void>> {
    this.openFlag = false;
    try {
      await this.socket.close();
    } catch (cause) {
      const error = mapTcpError(cause);
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
          technicalMessage: "tcp connection is not open",
        }),
      );
    }
    try {
      // resolve 仅表示已提交给 OS 缓冲，不表示对端已响应。
      await this.socket.write(bytes);
      return ok(undefined);
    } catch (cause) {
      return fail(mapTcpError(cause));
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
