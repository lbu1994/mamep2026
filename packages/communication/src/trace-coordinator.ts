/**
 * 轨迹追踪协调器（TM）：按 Speed 设定的间隔对目标寄存器持续采样。
 * 采样走统一调度器；缓冲与历史数据由调用方（register-table / UI）管理。
 */
import type { RequestRoute } from "@mamep2026/domain";
import type { Clock, TimeoutHandle } from "./clock";
import type { CommunicationSession, ReadRequestContext } from "./session";
import {
  createCancellationToken,
  type CancellationToken,
} from "./cancellation";

/** Receiver-owned identity; a new generation invalidates earlier IPC samples. */
export interface TraceIdentity {
  sheetId: string;
  rowId: string;
  generation: number;
}

export interface TraceSample extends ReadRequestContext {
  key: string;
  generation: number;
  sequence: number;
  rawValue: number;
  /** Original words preserve all bits of multi-register floating-point samples. */
  rawValues?: number[] | undefined;
  timestamp: number;
}

interface TraceEntry {
  /** Coordinator-owned generation; changes even when a caller reuses its identity. */
  generation: number;
  identity: TraceIdentity;
  cancelToken: CancellationToken;
  key: string;
  address: number;
  speedMs: number;
  /** 覆盖的连续寄存器数：缺省/1=单寄存器；>1 时采样组合数值。 */
  quantity: number;
  route: RequestRoute;
  timer: TimeoutHandle | null;
  inFlight: boolean;
  sequence: number;
}

export class TraceCoordinator {
  private nextGeneration = 0;
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
    identity?: TraceIdentity,
  ): void {
    this.stop(key);
    const generation = ++this.nextGeneration;
    const entry: TraceEntry = {
      generation,
      identity: Object.freeze(
        identity
          ? { ...identity }
          : {
              sheetId: key,
              rowId: key,
              generation,
            },
      ),
      cancelToken: createCancellationToken(),
      key,
      address,
      speedMs,
      quantity,
      route: Object.freeze({ ...(route ?? this.session.getCurrentRoute()) }),
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
      entry.cancelToken.cancel("trace-stopped");
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
    if (this.entries.get(entry.key)?.generation !== entry.generation) return;
    if (entry.inFlight) {
      // 采样未完成时跳过本次，不积压。
      this.schedule(entry);
      return;
    }
    entry.inFlight = true;
    // Capture identity at submission, before the scheduler can delay the read.
    const request = this.session.createReadRequest(
      entry.address,
      entry.quantity,
      {
        source: "trace",
        priority: "polling",
        route: entry.route,
        cancelToken: entry.cancelToken,
      },
      entry.identity,
    );
    void request.result.then((result) => {
      entry.inFlight = false;
      if (
        this.entries.get(entry.key)?.generation === entry.generation &&
        result.ok
      ) {
        entry.sequence += 1;
        const sample: TraceSample = {
          ...request.context,
          generation: entry.identity.generation,
          key: entry.key,
          sequence: entry.sequence,
          rawValue: combinedNumeric(result.value),
          rawValues: [...result.value],
          timestamp: this.clock.now(),
        };
        for (const listener of this.listeners) listener(sample);
      }
    });
    this.schedule(entry);
  }
}

/** 多寄存器组合数值（大端）：用于 Trace 采样（可视化用，不保证 2^53 以上精度）。 */
function combinedNumeric(values: number[]): number {
  let combined = 0;
  for (const value of values) combined = combined * 0x10000 + value;
  return combined;
}
