/**
 * 模拟 Modbus RTU 设备传输（dev-only，生产构建不启用）。
 * 用途：浏览器端 E2E 与验收自动化（TECH_DESIGN §26.7 的 Host API 模拟模式）。
 * 行为：接收 FC03 读帧返回寄存器值；接收 FC0x10 写帧更新寄存器值；其他功能码回异常。
 */
import type { MamepError, Result } from "@mamep2026/domain";
import { createMamepError } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import type { TransportPort } from "@mamep2026/communication";
import { appendCrc, crc16Modbus } from "@mamep2026/protocol-modbus";

export class MockTransport implements TransportPort {
  readonly kind = "mock" as const;
  private openFlag = false;
  private readonly registers = new Map<number, number>();
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
    this.openFlag = true;
    return ok(undefined);
  }

  async close(): Promise<Result<void>> {
    this.openFlag = false;
    for (const listener of this.closeListeners) listener();
    return ok(undefined);
  }

  async write(bytes: Uint8Array): Promise<Result<void>> {
    if (!this.openFlag) {
      return fail(
        createMamepError({
          code: "TRANSPORT_NOT_OPEN",
          category: "transport",
          userMessageKey: "errors.transportNotOpen",
          technicalMessage: "mock transport is not open",
        }),
      );
    }
    // 模拟设备处理：异步响应（微任务），模拟真实设备延迟。
    queueMicrotask(() => this.handleFrame(bytes));
    return ok(undefined);
  }

  isOpen(): boolean {
    return this.openFlag;
  }

  setRegister(address: number, value: number): void {
    this.registers.set(address & 0xffff, value & 0xffff);
  }

  getRegister(address: number): number | null {
    return this.registers.get(address & 0xffff) ?? null;
  }

  dumpRegisters(): Record<string, number> {
    const dump: Record<string, number> = {};
    for (const [address, value] of this.registers) {
      dump[address.toString(16).toUpperCase().padStart(4, "0")] = value;
    }
    return dump;
  }

  private handleFrame(bytes: Uint8Array): void {
    if (bytes.length < 8) return;
    const slave = bytes[0] ?? 0;
    const functionCode = bytes[1] ?? 0;
    const address = ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);

    if (functionCode === 0x03) {
      const value = this.registers.get(address) ?? 0;
      this.respond(
        Uint8Array.from([slave, 0x03, 0x02, (value >> 8) & 0xff, value & 0xff]),
      );
      return;
    }
    if (functionCode === 0x10) {
      const value = ((bytes[7] ?? 0) << 8) | (bytes[8] ?? 0);
      this.registers.set(address, value);
      this.respond(
        Uint8Array.from([
          slave,
          0x10,
          (address >> 8) & 0xff,
          address & 0xff,
          0x00,
          0x01,
        ]),
      );
      return;
    }
    // 不支持的功能码：回异常响应。
    this.respond(Uint8Array.from([slave, functionCode | 0x80, 0x01]));
  }

  private respond(body: Uint8Array): void {
    const frame = appendCrc(body);
    for (const listener of this.dataListeners) listener(frame);
  }
}

/** E2E 钩子：dev 模式下挂到 window 供 Playwright 预置/断言寄存器值。 */
export function installMockHooks(transport: MockTransport): void {
  (window as unknown as { __mamepMock?: unknown }).__mamepMock = {
    setRegister: (address: number, value: number) =>
      transport.setRegister(address, value),
    getRegister: (address: number) => transport.getRegister(address),
    dumpRegisters: () => transport.dumpRegisters(),
  };
}

/** 供测试使用：对模拟设备帧计算 CRC 的工具（复用协议包实现）。 */
export function mockFrameCrc(body: Uint8Array): number {
  return crc16Modbus(body);
}
