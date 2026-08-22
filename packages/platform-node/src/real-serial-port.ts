/**
 * serialport 的真实封装（docs/TECH_DESIGN.md §34.3.1：候选库必须由 adapter 封装）。
 * 本文件是 platform-node 中唯一直接 import serialport 的模块。
 * serialport 类型/对象不得出现在本包公开 API 中。
 */
import { SerialPort } from "serialport";
import type {
  SerialPortFactoryLike,
  SerialPortInfoLike,
  SerialPortLike,
  SerialPortOpenLike,
} from "./serial-port-like";

/** 将 Buffer 安全转换为 Uint8Array（共享内存视图，事件回调内消费安全）。 */
function toUint8Array(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

export class RealSerialPort implements SerialPortLike {
  private readonly port: SerialPort;
  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: unknown) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(options: SerialPortOpenLike) {
    this.port = new SerialPort({
      path: options.path,
      baudRate: options.baudRate,
      dataBits: options.dataBits ?? 8,
      stopBits: options.stopBits ?? 1,
      parity: options.parity ?? "none",
      rtscts: options.rtscts ?? false,
      xon: options.xon ?? false,
      xoff: options.xoff ?? false,
      lock: options.lock ?? true,
      autoOpen: false,
      endOnClose: false,
    });
    this.port.on("data", (chunk: Buffer) => {
      const bytes = toUint8Array(chunk);
      for (const listener of this.dataListeners) listener(bytes);
    });
    this.port.on("error", (error: Error) => {
      for (const listener of this.errorListeners) listener(error);
    });
    this.port.on("close", () => {
      for (const listener of this.closeListeners) listener();
    });
    this.port.on("disconnect", (error: Error) => {
      for (const listener of this.errorListeners) listener(error);
    });
  }

  get isOpen(): boolean {
    return this.port.isOpen;
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port.open((error) => (error ? reject(error) : resolve()));
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port.close((error) => (error ? reject(error) : resolve()));
    });
  }

  write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      // 写错误可能走 'error' 事件而非回调（serialport 文档），临时监听保证可靠捕获。
      const onError = (error: Error) => {
        if (!settled) {
          settled = true;
          this.port.off("error", onError);
          reject(error);
        }
      };
      this.port.on("error", onError);
      this.port.write(
        Buffer.from(data.buffer, data.byteOffset, data.byteLength),
        (error) => {
          if (!settled) {
            settled = true;
            this.port.off("error", onError);
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          }
        },
      );
    });
  }

  drain(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port.drain((error) => (error ? reject(error) : resolve()));
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

export class RealSerialPortFactory implements SerialPortFactoryLike {
  async list(): Promise<SerialPortInfoLike[]> {
    const ports = await SerialPort.list();
    return ports.map((info) => ({
      path: info.path,
      manufacturer: info.manufacturer,
      serialNumber: info.serialNumber,
      pnpId: info.pnpId,
      locationId: info.locationId,
      productId: info.productId,
      vendorId: info.vendorId,
    }));
  }

  create(options: SerialPortOpenLike): SerialPortLike {
    return new RealSerialPort(options);
  }
}
