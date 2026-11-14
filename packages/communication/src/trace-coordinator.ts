/**
 * 轨迹追踪协调器（TM）：按 Speed 设定的间隔对目标寄存器持续采样。
 * 采样走统一调度器；缓冲与历史数据由调用方（register-table / UI）管理。
 */
import type { RequestRoute, Result } from "@mamep2026/domain";
import type { Clock, TimeoutHandle } from "./clock";
import type { CommunicationSession } from "./session";

export interface TraceSample {
  key: string;
  sequence: number;
  rawValue: number;
  timestamp: number;
}

interface TraceEntry {
  key: string;
  address: number;
  speedMs: number;
  /** 覆盖的连续寄存器数（ADR-030）：缺省/1=单寄存器；>1 时采样组合数值。 */
  quantity: number;
  route: RequestRoute;
  timer: TimeoutHandle | null;
  inFlight: boolean;
  sequence: number;
}

export class TraceCoordinator {
  private readonly entries = new Map<string, TraceEntry>();
  private readonly listeners = new Set<(sample: TraceSample) => void>();
  private readonly session: CommunicationSession;
  private readonly clock: Clock;

  constructor(session: CommunicationSession, clock: Clock) {
    this.session = session;
    this.clock = clock;
  }

  onSample(listener: (sample: TraceSample) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(
    key: string,
    address: number,
    speedMs: number,
    quantity = 1,
    route?: RequestRoute,
  ): void {
    this.stop(key);
    const entry: TraceEntry = {
      key,
      address,
      speedMs,
      quantity,
      route: route ? { ...route } : this.session.getCurrentRoute(),
      timer: null,
      inFlight: false,
      sequence: 0,
    };
    this.entries.set(key, entry);
    this.schedule(entry);
  }

  stop(key: string): void {
    const entry = this.entries.get(key);
    if (entry !== undefined) {
      entry.timer?.cancel();
      entry.timer = null;
      this.entries.delete(key);
    }
  }

  stopAll(): void {
    for (const key of [...this.entries.keys()]) this.stop(key);
  }

  private schedule(entry: TraceEntry): void {
    entry.timer = this.clock.schedule(() => this.tick(entry), entry.speedMs);
  }

  private tick(entry: TraceEntry): void {
    if (!this.entries.has(entry.key)) return;
    if (entry.inFlight) {
      // 采样未完成时跳过本次，不积压。
      this.schedule(entry);
      return;
    }
    entry.inFlight = true;
    // 多寄存器行（ADR-030）：一次读全部并按大端组合为数值采样（字符串行由 UI 禁用 TM）。
    const request =
      entry.quantity > 1
        ? this.session.readRegisters(entry.address, entry.quantity, {
            source: "trace",
            priority: "polling",
            route: entry.route,
          })
        : this.session.readRegister(entry.address, {
            source: "trace",
            priority: "polling",
            route: entry.route,
          });
    void request.then((result: Result<number | number[]>) => {
      entry.inFlight = false;
      if (this.entries.has(entry.key) && result.ok) {
        entry.sequence += 1;
        const sample: TraceSample = {
          key: entry.key,
          sequence: entry.sequence,
          rawValue: Array.isArray(result.value)
            ? combinedNumeric(result.value)
            : result.value,
          timestamp: this.clock.now(),
        };
        for (const listener of this.listeners) listener(sample);
      }
    });
    this.schedule(entry);
  }
}

/** 多寄存器组合数值（大端，ADR-030）：用于 Trace 采样（可视化用，不保证 2^53 以上精度）。 */
function combinedNumeric(values: number[]): number {
  let combined = 0;
  for (const value of values) combined = combined * 0x10000 + value;
  return combined;
}
