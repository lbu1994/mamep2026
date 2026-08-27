/**
 * dev/e2e 假串口工厂（MAMEP_FAKE_SERIAL=1 && isDev 门控，不进生产打包路径）。
 *
 * 实现 platform-node 的公开注入面 SerialPortFactoryLike / SerialPortLike，
 * 内联 CRC16 Modbus RTU responder（FC03 读 / FC0x10 写，单寄存器表共享状态）。
 * 参照 e2e-electron serial-rtu-loop 的 fake navigator.serial 模式，在 Extension Host
 * 进程内注入（VSCode Webview 无 navigator.serial，fake 必须位于宿主侧）。
 *
 * 使用：`MAMEP_FAKE_SERIAL=1` 时 extension.ts 装配 `new NodePlatformHost({ factory: new DevFakeSerialFactory() })`。
 * e2e 可经 devFakeSerialState 预置/断言寄存器（仅测试用，生产构建不装配）。
 */
import type {
  SerialPortFactoryLike,
  SerialPortInfoLike,
  SerialPortLike,
  SerialPortOpenLike,
} from "@mamep2026/platform-node";

/** 假端口路径（enumeration 下拉框展示项）。 */
export const FAKE_SERIAL_PORT = "FAKE-1";

/** e2e 可访问的共享状态（仅测试用）。 */
export const devFakeSerialState = {
  registers: new Map<number, number>(),
  /** must-multi 区起始地址（ADR-030）：null=关闭；该地址起单读/单写返回异常 0x02。 */
  mustMultiStart: null as number | null,
};

export function resetDevFakeSerial(): void {
  devFakeSerialState.registers.clear();
  devFakeSerialState.mustMultiStart = null;
}

/** CRC16（Modbus RTU）。权威实现见 packages/protocol-modbus/src/crc16.ts。 */
function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return crc;
}

function appendCrc(bytes: Uint8Array): Uint8Array {
  const crc = crc16(bytes);
  const out = new Uint8Array(bytes.length + 2);
  out.set(bytes);
  out[bytes.length] = crc & 0xff;
  out[bytes.length + 1] = (crc >> 8) & 0xff;
  return out;
}

class DevFakeSerialPort implements SerialPortLike {
  private opened = false;
  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: unknown) => void>();
  private readonly closeListeners = new Set<() => void>();

  get isOpen(): boolean {
    return this.opened;
  }

  async open(): Promise<void> {
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
    for (const listener of this.closeListeners) listener();
  }

  async write(data: Uint8Array): Promise<void> {
    const response = this.respond(data);
    if (response !== null) this.simulateData(response);
  }

  async drain(): Promise<void> {
    // Fake 无真实缓冲，drain 立即完成。
  }

  private respond(frame: Uint8Array): Uint8Array | null {
    if (frame.length < 8) return null;
    const slave = frame[0] ?? 0;
    const functionCode = frame[1] ?? 0;
    const address = ((frame[2] ?? 0) << 8) | (frame[3] ?? 0);
    if (functionCode === 0x03) {
      const quantity = ((frame[4] ?? 0) << 8) | (frame[5] ?? 0);
      // must-multi 区（ADR-030）：单读返回非法数据地址异常。
      if (
        devFakeSerialState.mustMultiStart !== null &&
        address >= devFakeSerialState.mustMultiStart &&
        quantity === 1
      ) {
        return appendCrc(Uint8Array.from([slave, 0x83, 0x02]));
      }
      const values: number[] = [];
      for (let i = 0; i < quantity; i += 1) {
        values.push(
          devFakeSerialState.registers.get((address + i) & 0xffff) ?? 0,
        );
      }
      return appendCrc(
        Uint8Array.from([
          slave,
          0x03,
          quantity * 2,
          ...values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]),
        ]),
      );
    }
    if (functionCode === 0x10) {
      const quantity = ((frame[4] ?? 0) << 8) | (frame[5] ?? 0);
      // must-multi 区（ADR-030）：单写返回非法数据地址异常。
      if (
        devFakeSerialState.mustMultiStart !== null &&
        address >= devFakeSerialState.mustMultiStart &&
        quantity === 1
      ) {
        return appendCrc(Uint8Array.from([slave, 0x90, 0x02]));
      }
      const values: number[] = [];
      for (let i = 0; i < quantity; i += 1) {
        values.push(
          (((frame[7 + i * 2] ?? 0) << 8) | (frame[8 + i * 2] ?? 0)) & 0xffff,
        );
      }
      for (let i = 0; i < quantity; i += 1) {
        devFakeSerialState.registers.set((address + i) & 0xffff, values[i] ?? 0);
      }
      return appendCrc(
        Uint8Array.from([
          slave,
          0x10,
          (address >> 8) & 0xff,
          address & 0xff,
          (quantity >> 8) & 0xff,
          quantity & 0xff,
        ]),
      );
    }
    return appendCrc(Uint8Array.from([slave, functionCode | 0x80, 0x01]));
  }

  simulateData(chunk: Uint8Array): void {
    for (const listener of this.dataListeners) listener(chunk);
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

export class DevFakeSerialFactory implements SerialPortFactoryLike {
  readonly ports: SerialPortInfoLike[] = [
    { path: FAKE_SERIAL_PORT, manufacturer: "Mamep2026 Fake" },
  ];

  async list(): Promise<SerialPortInfoLike[]> {
    return [...this.ports];
  }

  create(_options: SerialPortOpenLike): SerialPortLike {
    // 假端口共享模块级寄存器表（devFakeSerialState），忽略打开选项。
    return new DevFakeSerialPort();
  }
}
