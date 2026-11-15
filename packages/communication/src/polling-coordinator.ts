/**
 * 周期轮询协调器（docs/TECH_DESIGN.md §13）。
 * - 轮询间隔由调用方传入（2026-09-06 起应用层固定为 0，即读完一个立即读下一个）；
 * - 每个轮询行最多一个正在执行的任务，任务未完成时跳过本轮（不积压）并记录 skipped tick；
 * - 不提供全部行持续轮询（ALL Polling）：只有传入的 targets 会被轮询。
 */
import type {
  PollResultContext,
  RequestRoute,
  Result,
} from "@mamep2026/domain";
import type { Clock, TimeoutHandle } from "./clock";
import type { CommunicationSession } from "./session";

export interface PollingTarget {
  key: string;
  /** 行所属表；用于结果路由和页面绑定校验。 */
  sheetId: string;
  address: number;
  /** 覆盖的连续寄存器数（ADR-030）：缺省/1=单寄存器；>1 时一次 FC03 读全部。 */
  quantity?: number;
  /** 请求创建时固化的路由快照。 */
  route?: RequestRoute;
}

export interface PollingCoordinatorOptions {
  getIntervalMs: () => number;
}

export type PollingResultEvent = PollResultContext & {
  result: Result<number | number[]>;
};

interface ActivePollingTarget extends PollingTarget {
  route: RequestRoute;
  requestGeneration: number;
}

export class PollingCoordinator {
  private targets: ActivePollingTarget[] = [];
  private nextRequestGeneration = 0;
  private readonly targetFingerprints = new Map<
    string,
    { fingerprint: string; generation: number }
  >();
  private readonly inFlight = new Set<string>();
  private readonly skippedTicks = new Map<string, number>();
  /** 暂缓的轮询 key（写入+回读期间，§18.3）：tick 时与 inFlight 同语义跳过。 */
  private readonly deferred = new Set<string>();
  private timer: TimeoutHandle | null = null;
  private runningFlag = false;
  private readonly listeners = new Set<(event: PollingResultEvent) => void>();
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

  onResult(listener: (event: PollingResultEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setTargets(targets: PollingTarget[]): void {
    const nextTargets = targets.map((target): ActivePollingTarget => {
      const route = target.route
        ? { ...target.route }
        : this.session.getCurrentRoute();
      const fingerprint = JSON.stringify([
        target.sheetId,
        target.address,
        target.quantity ?? 1,
        route.unitAddress,
        route.protocol,
      ]);
      const previous = this.targetFingerprints.get(target.key);
      const requestGeneration =
        previous?.fingerprint === fingerprint
          ? previous.generation
          : ++this.nextRequestGeneration;
      this.targetFingerprints.set(target.key, {
        fingerprint,
        generation: requestGeneration,
      });
      return { ...target, route, requestGeneration };
    });

    const activeKeys = new Set(nextTargets.map((target) => target.key));
    for (const key of this.targetFingerprints.keys()) {
      if (!activeKeys.has(key)) this.targetFingerprints.delete(key);
    }
    this.targets = nextTargets;
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
    const wasRunning = this.runningFlag;
    this.runningFlag = false;
    this.timer?.cancel();
    this.timer = null;
    // 已发出的请求仍可能返回；停止轮询时推进目标代次，确保它们不再回写。
    if (wasRunning) {
      for (const target of this.targets) {
        target.requestGeneration = ++this.nextRequestGeneration;
        const tracked = this.targetFingerprints.get(target.key);
        if (tracked !== undefined) {
          tracked.generation = target.requestGeneration;
        }
      }
    }
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
      // 请求创建时固化完整身份；返回后与当前目标逐项比较，避免迟到结果串路由。
      const requestContext = {
        key: target.key,
        sheetId: target.sheetId,
        address: target.address,
        route: { ...target.route },
        requestGeneration: target.requestGeneration,
      } satisfies PollResultContext;
      const quantity = target.quantity ?? 1;
      // 多寄存器行（ADR-030）：一次 FC03 读全部，结果携带 values[]。
      const request =
        quantity > 1
          ? this.session.readRegisters(target.address, quantity, {
              source: "polling",
              priority: "polling",
              route: target.route,
            })
          : this.session.readRegister(target.address, {
              source: "polling",
              priority: "polling",
              route: target.route,
            });
      void request.then((result) => {
        this.inFlight.delete(target.key);
        const current = this.targets.find(
          (candidate) => candidate.key === requestContext.key,
        );
        if (
          current === undefined ||
          current.requestGeneration !== requestContext.requestGeneration
        ) {
          return;
        }
        for (const listener of this.listeners)
          listener({ ...requestContext, result });
      });
    }
    this.scheduleNext();
  }
}
