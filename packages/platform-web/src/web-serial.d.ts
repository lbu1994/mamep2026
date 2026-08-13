/**
 * Web Serial API 最小类型声明（lib.dom 未内置该 API）。
 * 只声明本应用使用的成员。
 */
export interface SerialPortInfo {
  usbVendorId?: number | undefined;
  usbProductId?: number | undefined;
}

export interface SerialOptions {
  baudRate: number;
  dataBits?: 7 | 8 | undefined;
  stopBits?: 1 | 2 | undefined;
  parity?: "none" | "even" | "odd" | undefined;
  bufferSize?: number | undefined;
  flowControl?: "none" | "hardware" | undefined;
}

export interface SerialPort {
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
}

export interface Serial {
  getPorts(): Promise<SerialPort[]>;
  requestPort(): Promise<SerialPort>;
}

declare global {
  interface Navigator {
    readonly serial?: Serial;
  }
}
