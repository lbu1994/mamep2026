/**
 * Node `net` 的真实封装（Node TCP Adapter，docs/TECH_DESIGN.md §34.3.16）。
 * 本文件是 platform-node 中唯一直接 import node:net 的模块。
 * net 的类型/对象不得出现在本包公开 API 中。
 */
import { Socket } from "node:net";
import type { NetFactoryLike, SocketLike, TcpConnectLike } from "./socket-like";

/** 将 Buffer 安全转换为 Uint8Array（共享内存视图，事件回调内消费安全）。 */
function toUint8Array(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

export class RealSocket implements SocketLike {
  private readonly socket = new Socket();
  private readonly host: string;
  private readonly port: number;
  private opened = false;
  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: unknown) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(options: TcpConnectLike) {
    this.host = options.host;
    this.port = options.port;
    this.socket.on("data", (chunk: Buffer) => {
      const bytes = toUint8Array(chunk);
      for (const listener of this.dataListeners) listener(bytes);
    });
    this.socket.on("error", (error: Error) => {
      for (const listener of this.errorListeners) listener(error);
    });
    this.socket.on("close", () => {
      this.opened = false;
      for (const listener of this.closeListeners) listener();
    });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.opened) {
        resolve();
        return;
      }
      const onConnect = () => {
        cleanup();
        this.opened = true;
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onClose = () => {
        cleanup();
        reject(
          new Error(
            `tcp connection closed before connect (${this.host}:${this.port})`,
          ),
        );
      };
      const cleanup = () => {
        this.socket.off("connect", onConnect);
        this.socket.off("error", onError);
        this.socket.off("close", onClose);
      };
      this.socket.once("connect", onConnect);
      this.socket.once("error", onError);
      this.socket.once("close", onClose);
      this.socket.connect({ host: this.host, port: this.port });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.readyState === "closed") {
        resolve();
        return;
      }
      this.socket.once("close", () => resolve());
      this.socket.destroy();
    });
  }

  write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.write(data, (error) => (error ? reject(error) : resolve()));
    });
  }

  onData(listener: (chunk: Uint8Array) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onError(listener: (error: unknown) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }
}

export class RealNetFactory implements NetFactoryLike {
  connect(options: TcpConnectLike): SocketLike {
    return new RealSocket(options);
  }
}
