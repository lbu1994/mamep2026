/**
 * 轨迹追踪协调器（TM）：按 Speed 设定的间隔对目标寄存器持续采样。
 * 采样走统一调度器；缓冲与历史数据由调用方（register-table / UI）管理。
 */
import type { Result } from "@mamep2026/domain";
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

  start(key: string, address: number, speedMs: number): void {
    this.stop(key);
    const entry: TraceEntry = {
      key,
      address,
      speedMs,
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
    void this.session
      .readRegister(entry.address, { source: "trace", priority: "polling" })
      .then((result: Result<number>) => {
        entry.inFlight = false;
        if (this.entries.has(entry.key) && result.ok) {
          entry.sequence += 1;
          const sample: TraceSample = {
            key: entry.key,
            sequence: entry.sequence,
            rawValue: result.value,
            timestamp: this.clock.now(),
          };
          for (const listener of this.listeners) listener(sample);
        }
      });
    this.schedule(entry);
  }
}
