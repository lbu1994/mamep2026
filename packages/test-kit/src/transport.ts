/**
 * 测试工具包（docs/TECH_DESIGN.md §6.14）：Fake Transport、虚拟时钟、
 * Scripted Modbus RTU 模拟设备、内存工作区仓储与工厂。
 * 仅供测试引用，不进入生产 bundle。
 */
import type { MamepError, Result } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import type { Clock, TransportPort } from "@mamep2026/communication";
import { appendCrc } from "@mamep2026/protocol-modbus";

/** 可编程 Modbus RTU 模拟设备：寄存器表 + 自动应答 FC03/FC0x10。 */
export class ScriptedModbusRtuDevice {
  readonly registers = new Map<number, number>();

  setRegister(address: number, value: number): void {
    this.registers.set(address & 0xffff, value & 0xffff);
  }

  getRegister(address: number): number | null {
    return this.registers.get(address & 0xffff) ?? null;
  }

  /** 处理设备收到的帧；返回应回传的字节，null 表示不应答（用于模拟超时）。 */
  handleFrame(frame: Uint8Array): Uint8Array | null {
    if (frame.length < 8) return null;
    const slave = frame[0] ?? 0;
    const functionCode = frame[1] ?? 0;
    const address = ((frame[2] ?? 0) << 8) | (frame[3] ?? 0);
    if (functionCode === 0x03) {
      const value = this.registers.get(address) ?? 0;
      return appendCrc(
        Uint8Array.from([slave, 0x03, 0x02, (value >> 8) & 0xff, value & 0xff]),
      );
    }
    if (functionCode === 0x10) {
      const value = ((frame[7] ?? 0) << 8) | (frame[8] ?? 0);
      this.registers.set(address, value);
      return appendCrc(
        Uint8Array.from([
          slave,
          0x10,
          (address >> 8) & 0xff,
          address & 0xff,
          0x00,
          0x01,
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
