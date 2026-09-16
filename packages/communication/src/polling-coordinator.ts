/**
 * 周期轮询协调器（docs/TECH_DESIGN.md §13）。
 * - 轮询间隔由调用方传入（2026-09-06 起应用层固定为 0，即读完一个立即读下一个）；
 * - 每个轮询行最多一个正在执行的任务，任务未完成时跳过本轮（不积压）并记录 skipped tick；
 * - 不提供全部行持续轮询（ALL Polling）：只有传入的 targets 会被轮询。
 */
import type { Result } from "@mamep2026/domain";
import type { Clock, TimeoutHandle } from "./clock";
import type { CommunicationSession } from "./session";

export interface PollingTarget {
  key: string;
  address: number;
  /** 覆盖的连续寄存器数（ADR-030）：缺省/1=单寄存器；>1 时一次 FC03 读全部。 */
  quantity?: number;
}

export interface PollingCoordinatorOptions {
  getIntervalMs: () => number;
}

export class PollingCoordinator {
  private targets: PollingTarget[] = [];
  private readonly inFlight = new Set<string>();
  private readonly skippedTicks = new Map<string, number>();
  /** 暂缓的轮询 key（写入+回读期间，§18.3）：tick 时与 inFlight 同语义跳过。 */
  private readonly deferred = new Set<string>();
  private timer: TimeoutHandle | null = null;
  private runningFlag = false;
  private readonly listeners = new Set<
    (key: string, address: number, result: Result<number | number[]>) => void
  >();
  private readonly session: CommunicationSession;
  private readonly clock: Clock;
  private readonly options: PollingCoordinatorOptions;

  constructor(
    session: CommunicationSession,
    clock: Clock,
    options: PollingCoordinatorOptions,
  ) {
    this.session = session;
    this.clock = clock;
    this.options = options;
  }

  get isRunning(): boolean {
    return this.runningFlag;
  }

  getSkippedTicks(key: string): number {
    return this.skippedTicks.get(key) ?? 0;
  }

  onResult(
    listener: (
      key: string,
      address: number,
      result: Result<number | number[]>,
    ) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setTargets(targets: PollingTarget[]): void {
    this.targets = [...targets];
  }

  /** 暂缓指定 key 的轮询（写入+回读期间，§18.3）；已暂缓为幂等 no-op。 */
  defer(key: string): void {
    this.deferred.add(key);
  }

  /** 恢复指定 key 的轮询；未暂缓为幂等 no-op。 */
  resume(key: string): void {
    this.deferred.delete(key);
  }

  start(): void {
    if (this.runningFlag) return;
    this.runningFlag = true;
    this.scheduleNext();
  }

  stop(): void {
    this.runningFlag = false;
    this.timer?.cancel();
    this.timer = null;
  }

  private scheduleNext(): void {
    this.timer = this.clock.schedule(
      () => this.tick(),
      this.options.getIntervalMs(),
    );
  }

  private tick(): void {
    if (!this.runningFlag) return;
    for (const target of this.targets) {
      if (this.inFlight.has(target.key) || this.deferred.has(target.key)) {
        this.skippedTicks.set(
          target.key,
          (this.skippedTicks.get(target.key) ?? 0) + 1,
        );
        continue;
      }
      this.inFlight.add(target.key);
      // 捕获请求时的地址快照：上层据此丢弃旧地址的迟到结果（generation 失效）。
      const requestedAddress = target.address;
      const quantity = target.quantity ?? 1;
      // 多寄存器行（ADR-030）：一次 FC03 读全部，结果携带 values[]。
      const request =
        quantity > 1
          ? this.session.readRegisters(target.address, quantity, {
              source: "polling",
              priority: "polling",
            })
          : this.session.readRegister(target.address, {
              source: "polling",
              priority: "polling",
            });
      void request.then((result) => {
        this.inFlight.delete(target.key);
        for (const listener of this.listeners)
          listener(target.key, requestedAddress, result);
      });
    }
    this.scheduleNext();
  }
}
