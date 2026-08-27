/**
 * 模拟 Modbus RTU 设备传输（dev-only，生产构建不启用）。
 * 用途：浏览器端 E2E 与验收自动化（TECH_DESIGN §26.7 的 Host API 模拟模式）。
 * 行为：按「地址区间 → 读写行为」规则（默认见 ./mock-scenarios.ts）区分成功/失败场景——
 * 正常读/写返回成功；只读/只写/不存在/非法值/不支持功能回对应 Modbus 异常；
 * 无响应区间不回任何帧（触发请求超时/重试路径）；其他功能码回异常。
 * 未配置地址回退为正常行为。
 */
import type { MamepError, Result } from "@mamep2026/domain";
import { createMamepError } from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import type { TransportPort } from "@mamep2026/communication";
import {
  appendCrc,
  crc16Modbus,
  EXCEPTION_ILLEGAL_DATA_ADDRESS,
  EXCEPTION_ILLEGAL_DATA_VALUE,
} from "@mamep2026/protocol-modbus";
import {
  DEFAULT_MOCK_RULES,
  matchMockRule,
  type MockRangeRule,
} from "./mock-scenarios";

export class MockTransport implements TransportPort {
  readonly kind = "mock" as const;
  private openFlag = false;
  private readonly registers = new Map<number, number>();
  private readonly rules: readonly MockRangeRule[];
  private readonly dataListeners = new Set<(chunk: Uint8Array) => void>();
  private readonly errorListeners = new Set<(error: MamepError) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(rules: readonly MockRangeRule[] = DEFAULT_MOCK_RULES) {
    this.rules = rules;
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
    const rule = matchMockRule(this.rules, address);

    if (functionCode === 0x03) {
      const behavior = rule?.read ?? { kind: "normal" };
      if (behavior.kind === "no-response") return;
      if (behavior.kind === "exception") {
        this.respond(this.exceptionFrame(slave, 0x03, behavior.exceptionCode));
        return;
      }
      const quantity = ((bytes[4] ?? 0) << 8) | (bytes[5] ?? 0);
      // must-multi 区（ADR-030）：单读返回非法数据地址异常。
      if (rule?.mustMulti === true && quantity === 1) {
        this.respond(
          this.exceptionFrame(slave, 0x03, EXCEPTION_ILLEGAL_DATA_ADDRESS),
        );
        return;
      }
      // normal / write-value-gate（读按正常处理）：返回 quantity 个寄存器值。
      const values: number[] = [];
      for (let i = 0; i < quantity; i += 1) {
        values.push(this.registers.get((address + i) & 0xffff) ?? 0);
      }
      this.respond(
        Uint8Array.from([
          slave,
          0x03,
          quantity * 2,
          ...values.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]),
        ]),
      );
      return;
    }
    if (functionCode === 0x10) {
      const behavior = rule?.write ?? { kind: "normal" };
      const quantity = ((bytes[4] ?? 0) << 8) | (bytes[5] ?? 0);
      const byteCount = bytes[6] ?? 0;
      // must-multi 区（ADR-030）：单写返回非法数据地址异常。
      if (rule?.mustMulti === true && quantity === 1) {
        this.respond(
          this.exceptionFrame(slave, 0x10, EXCEPTION_ILLEGAL_DATA_ADDRESS),
        );
        return;
      }
      if (behavior.kind === "no-response") return;
      if (behavior.kind === "exception") {
        this.respond(this.exceptionFrame(slave, 0x10, behavior.exceptionCode));
        return;
      }
      const values: number[] = [];
      for (let i = 0; i < quantity; i += 1) {
        values.push(
          (((bytes[7 + i * 2] ?? 0) << 8) | (bytes[8 + i * 2] ?? 0)) & 0xffff,
        );
      }
      void byteCount;
      if (
        behavior.kind === "write-value-gate" &&
        values.some((v) => v > behavior.maxValue)
      ) {
        this.respond(
          this.exceptionFrame(slave, 0x10, EXCEPTION_ILLEGAL_DATA_VALUE),
        );
        return;
      }
      if (behavior.kind === "write-ignore") {
        // 写忽略区：回执成功但不写入（模拟「写不生效」——回读仍为旧值）。
        this.respond(
          Uint8Array.from([
            slave,
            0x10,
            (address >> 8) & 0xff,
            address & 0xff,
            (quantity >> 8) & 0xff,
            quantity & 0xff,
          ]),
        );
        return;
      }
      for (let i = 0; i < quantity; i += 1) {
        this.registers.set((address + i) & 0xffff, values[i] ?? 0);
      }
      this.respond(
        Uint8Array.from([
          slave,
          0x10,
          (address >> 8) & 0xff,
          address & 0xff,
          (quantity >> 8) & 0xff,
          quantity & 0xff,
        ]),
      );
      return;
    }
    // 不支持的功能码：回异常响应。
    this.respond(Uint8Array.from([slave, functionCode | 0x80, 0x01]));
  }

  /** 构造异常响应体（slave + fc|0x80 + exceptionCode；CRC 由 respond 追加，共 5 字节）。 */
  private exceptionFrame(
    slave: number,
    functionCode: number,
    exceptionCode: number,
  ): Uint8Array {
    return Uint8Array.from([slave, functionCode | 0x80, exceptionCode]);
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
