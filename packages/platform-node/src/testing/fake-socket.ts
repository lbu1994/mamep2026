/**
 * Fake TCP Socket（Layer 1 测试，docs/TECH_DESIGN.md §34.3.20 第一层）。
 * 注入打开/关闭/读/写/连接拒绝/分片/迟到/错误注入/被动关闭等场景。
 * 与 testing/fake-serial-port.ts 风格一致。
 */
import type {
  NetFactoryLike,
  SocketLike,
  TcpConnectLike,
} from "../socket-like";

export class FakeSocket implements SocketLike {
  readonly openedOptions: TcpConnectLike;
  opened = false;
  closed = false;
  readonly sentFrames: Uint8Array[] = [];
  /** 打开时抛出的错误（抛一次后清空，用于一次性注入）。 */
  openError: unknown = undefined;
  /** 写入时抛出的错误（抛一次后清空）。 */
  writeError: unknown = undefined;
  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: unknown) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(options: TcpConnectLike) {
    this.openedOptions = options;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  async open(): Promise<void> {
    if (this.openError !== undefined) {
      const error = this.openError;
      this.openError = undefined;
      throw error;
    }
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
    this.closed = true;
    for (const listener of this.closeListeners) listener();
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.writeError !== undefined) {
      const error = this.writeError;
      this.writeError = undefined;
      throw error;
    }
    this.sentFrames.push(data);
  }

  /** 模拟底层收到数据（可多次调用以模拟分片/连续到达/迟到）。 */
  simulateData(chunk: Uint8Array): void {
    for (const listener of this.dataListeners) listener(chunk);
  }

  /** 模拟底层错误事件。 */
  simulateError(error: unknown): void {
    for (const listener of this.errorListeners) listener(error);
  }

  /** 模拟对端关闭/连接断开（未调用 close 的被动关闭）。 */
  simulateClose(): void {
    this.opened = false;
    for (const listener of this.closeListeners) listener();
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

export class FakeNetFactory implements NetFactoryLike {
  readonly created: FakeSocket[] = [];

  connect(options: TcpConnectLike): FakeSocket {
    const socket = new FakeSocket(options);
    this.created.push(socket);
    return socket;
  }
}
