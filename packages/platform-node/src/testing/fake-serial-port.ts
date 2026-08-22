/**
 * Fake Serial Port（层 1 测试，docs/TECH_DESIGN.md §34.3.20 第一层）。
 * 注入打开/关闭/读/写/超时/取消/拔出/错误/分片/迟到/重复连接等场景。
 * 与 packages/test-kit 的 FakeTransport 风格一致：可挂 ScriptedModbusRtuDevice 自动应答。
 */
import type { ScriptedModbusRtuDevice } from "@mamep2026/test-kit";
import type {
  SerialPortFactoryLike,
  SerialPortInfoLike,
  SerialPortLike,
  SerialPortOpenLike,
} from "../serial-port-like";

export class FakeSerialPort implements SerialPortLike {
  readonly openedOptions: SerialPortOpenLike;
  opened = false;
  closed = false;
  readonly sentFrames: Uint8Array[] = [];
  /** 打开时抛出的错误（抛一次后清空，用于一次性注入）。 */
  openError: unknown = undefined;
  /** 写入时抛出的错误（抛一次后清空）。 */
  writeError: unknown = undefined;
  /** 可选的模拟设备：write 后自动回帧。 */
  device: ScriptedModbusRtuDevice | null = null;
  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: unknown) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(options: SerialPortOpenLike) {
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
    const device = this.device;
    if (device !== null) {
      const response = device.handleFrame(data);
      if (response !== null) this.simulateData(response);
    }
  }

  async drain(): Promise<void> {
    // Fake 无真实缓冲，drain 立即完成。
  }

  /** 模拟底层收到数据（可多次调用以模拟分片/连续到达/迟到）。 */
  simulateData(chunk: Uint8Array): void {
    for (const listener of this.dataListeners) listener(chunk);
  }

  /** 模拟底层错误事件。 */
  simulateError(error: unknown): void {
    for (const listener of this.errorListeners) listener(error);
  }

  /** 模拟设备拔出/底层关闭（未调用 close 的被动关闭）。 */
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

export class FakeSerialPortFactory implements SerialPortFactoryLike {
  readonly ports: readonly SerialPortInfoLike[];
  /** 枚举时抛出的错误（抛一次后清空）。 */
  listError: unknown = undefined;
  readonly created: FakeSerialPort[] = [];

  constructor(ports: readonly SerialPortInfoLike[] = []) {
    this.ports = ports;
  }

  async list(): Promise<SerialPortInfoLike[]> {
    if (this.listError !== undefined) {
      const error = this.listError;
      this.listError = undefined;
      throw error;
    }
    return [...this.ports];
  }

  create(options: SerialPortOpenLike): FakeSerialPort {
    const port = new FakeSerialPort(options);
    this.created.push(port);
    return port;
  }
}
