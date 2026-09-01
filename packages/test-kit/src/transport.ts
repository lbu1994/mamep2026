/**
 * 测试工具包（docs/TECH_DESIGN.md §6.14）：Fake Transport、虚拟时钟、
 * Scripted Modbus RTU 模拟设备、内存工作区仓储与工厂。
 * 仅供测试引用，不进入生产 bundle。
 */
import type { MamepError, Result } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import type { Clock, TransportPort } from "@mamep2026/communication";
import { appendCrc } from "@mamep2026/protocol-modbus";

/** 可编程 Modbus RTU 模拟设备：寄存器表 + 自动应答 FC03/FC0x10（含多寄存器，ADR-030），
 * 以及基础表 FC01/FC02/FC04/FC0F（线圈/离散输入/输入寄存器，ADR-043 E-1）。 */
export class ScriptedModbusRtuDevice {
  readonly registers = new Map<number, number>();
  /** 线圈（FC01 读 / FC0F 写），值为 0/1。 */
  readonly coils = new Map<number, number>();
  /** 离散输入（FC02 读），值为 0/1。 */
  readonly inputs = new Map<number, number>();
  /** 输入寄存器（FC04 读）。 */
  readonly inputRegisters = new Map<number, number>();
  /**
   * 「must-multi」区起始地址（null=关闭，ADR-030）：该地址起，
   * 单寄存器读/写（quantity===1）返回异常 0x02，多寄存器读/写（quantity>1）正常——
   * 模拟真实设备「某些寄存器必须连续读写」的约束，供测试断言。
   */
  mustMultiStart: number | null = null;

  setRegister(address: number, value: number): void {
    this.registers.set(address & 0xffff, value & 0xffff);
  }

  getRegister(address: number): number | null {
    return this.registers.get(address & 0xffff) ?? null;
  }

  setCoil(address: number, value: number): void {
    this.coils.set(address & 0xffff, value === 0 ? 0 : 1);
  }

  getCoil(address: number): number | null {
    return this.coils.get(address & 0xffff) ?? null;
  }

  setInput(address: number, value: number): void {
    this.inputs.set(address & 0xffff, value === 0 ? 0 : 1);
  }

  getInput(address: number): number | null {
    return this.inputs.get(address & 0xffff) ?? null;
  }

  setInputRegister(address: number, value: number): void {
    this.inputRegisters.set(address & 0xffff, value & 0xffff);
  }

  getInputRegister(address: number): number | null {
    return this.inputRegisters.get(address & 0xffff) ?? null;
  }

  /** 位打包读（FC01/FC02）：逐位取 map 值（缺省 0），LSB 在前。 */
  private readBits(
    map: Map<number, number>,
    slave: number,
    functionCode: number,
    address: number,
    quantity: number,
  ): Uint8Array {
    const byteCount = Math.ceil(quantity / 8);
    const data = new Uint8Array(byteCount);
    for (let i = 0; i < quantity; i += 1) {
      const value = map.get((address + i) & 0xffff) ?? 0;
      if (value !== 0) {
        const index = i >> 3;
        data[index] = (data[index] ?? 0) | (1 << (i & 7));
      }
    }
    return appendCrc(
      Uint8Array.from([slave, functionCode, byteCount, ...data]),
    );
  }

  /** 处理设备收到的帧；返回应回传的字节，null 表示不应答（用于模拟超时）。 */
  handleFrame(frame: Uint8Array): Uint8Array | null {
    if (frame.length < 8) return null;
    const slave = frame[0] ?? 0;
    const functionCode = frame[1] ?? 0;
    const address = ((frame[2] ?? 0) << 8) | (frame[3] ?? 0);
    const quantity = ((frame[4] ?? 0) << 8) | (frame[5] ?? 0);
    if (functionCode === 0x03) {
      // must-multi 区：单读返回非法数据地址异常。
      if (
        this.mustMultiStart !== null &&
        address >= this.mustMultiStart &&
        quantity === 1
      ) {
        return appendCrc(Uint8Array.from([slave, 0x83, 0x02]));
      }
      const values: number[] = [];
      for (let i = 0; i < quantity; i += 1) {
        values.push(this.registers.get((address + i) & 0xffff) ?? 0);
      }
      const byteCount = quantity * 2;
      const body = Uint8Array.from([
        slave,
        0x03,
        byteCount,
        ...values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]),
      ]);
      return appendCrc(body);
    }
    if (functionCode === 0x04) {
      const values: number[] = [];
      for (let i = 0; i < quantity; i += 1) {
        values.push(this.inputRegisters.get((address + i) & 0xffff) ?? 0);
      }
      const byteCount = quantity * 2;
      const body = Uint8Array.from([
        slave,
        0x04,
        byteCount,
        ...values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]),
      ]);
      return appendCrc(body);
    }
    if (functionCode === 0x01) {
      return this.readBits(
        this.coils,
        slave,
        0x01,
        address,
        quantity,
      );
    }
    if (functionCode === 0x02) {
      return this.readBits(
        this.inputs,
        slave,
        0x02,
        address,
        quantity,
      );
    }
    if (functionCode === 0x10) {
      // must-multi 区：单写返回非法数据地址异常。
      if (
        this.mustMultiStart !== null &&
        address >= this.mustMultiStart &&
        quantity === 1
      ) {
        return appendCrc(Uint8Array.from([slave, 0x90, 0x02]));
      }
      for (let i = 0; i < quantity; i += 1) {
        const hi = frame[7 + i * 2] ?? 0;
        const lo = frame[8 + i * 2] ?? 0;
        this.registers.set((address + i) & 0xffff, (hi << 8) | lo);
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
    if (functionCode === 0x0f) {
      const byteCount = frame[6] ?? 0;
      for (let i = 0; i < quantity; i += 1) {
        const byteIndex = i >> 3;
        const bitIndex = i & 7;
        const byte = byteIndex < byteCount ? (frame[7 + byteIndex] ?? 0) : 0;
        this.coils.set((address + i) & 0xffff, (byte >> bitIndex) & 1);
      }
      return appendCrc(
        Uint8Array.from([
          slave,
          0x0f,
          (address >> 8) & 0xff,
          address & 0xff,
          (quantity >> 8) & 0xff,
          quantity & 0xff,
        ]),
      );
    }
    return appendCrc(Uint8Array.from([slave, functionCode | 0x80, 0x01]));
  }
}

export class FakeTransport implements TransportPort {
  readonly kind = "fake" as const;
  opened = false;
  closed = false;
  sentFrames: Uint8Array[] = [];
  /** 可选的模拟设备：write 后自动回帧。 */
  device: ScriptedModbusRtuDevice | null = null;
  /** 模拟设备响应延迟（默认 0，立即回帧）。 */
  respondImmediately = true;
  private failWrites = false;
  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: MamepError) => void>();
  private readonly closeListeners = new Set<() => void>();

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
        technicalMessage: "write failed (fake)",
      });
    }
    this.sentFrames.push(bytes);
    const device = this.device;
    if (device !== null) {
      const response = device.handleFrame(bytes);
      if (response !== null) {
        if (this.respondImmediately) {
          this.simulateData(response);
        } else {
          void Promise.resolve().then(() => this.simulateData(response));
        }
      }
    }
    return ok(undefined);
  }

  isOpen(): boolean {
    return this.opened;
  }

  setFailWrites(value: boolean): void {
    this.failWrites = value;
  }

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

/** 虚拟时钟：手动推进，用于调度/轮询/超时测试（禁止真实等待）。 */
export class VirtualClock implements Clock {
  nowValue = 0;
  private timers: Array<{ dueAt: number; id: number; callback: () => void }> =
    [];
  private nextId = 1;

  now(): number {
    return this.nowValue;
  }

  schedule(callback: () => void, delayMs: number): { cancel(): void } {
    const id = this.nextId++;
    const timer = { dueAt: this.nowValue + delayMs, id, callback };
    this.timers.push(timer);
    return {
      cancel: () => {
        this.timers = this.timers.filter((t) => t.id !== id);
      },
    };
  }

  advance(ms: number): void {
    this.nowValue += ms;
    const due = this.timers
      .filter((t) => t.dueAt <= this.nowValue)
      .sort((a, b) => a.dueAt - b.dueAt);
    this.timers = this.timers.filter((t) => t.dueAt > this.nowValue);
    for (const timer of due) timer.callback();
  }
}
