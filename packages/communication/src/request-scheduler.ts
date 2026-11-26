/**
 * 单连接请求调度器（docs/AGENTS.md §12）。
 * - 同一连接任意时刻只执行一个设备请求；
 * - 优先级只影响尚未开始的任务，不中断已发送请求；
 * - 公平性：等待超过阈值的任务按 FIFO 执行，避免低优先级饥饿；
 * - 任务紧接执行（不附加请求间隔删除 Rx Delay）。
 */
import { createMamepError, type Result } from "@mamep2026/domain";
import { fail } from "@mamep2026/domain";
import type { CancellationToken } from "./cancellation";
import type { Clock } from "./clock";

export type RequestPriority =
  | "connection-control"
  | "manual-write"
  | "manual-read"
  | "write-verify"
  | "batch-read"
  | "polling"
  | "plugin-background";

const PRIORITY_ORDER: readonly RequestPriority[] = [
  "connection-control",
  "manual-write",
  "manual-read",
  "write-verify",
  "batch-read",
  "polling",
  "plugin-background",
];

interface Task {
  id: number;
  priority: RequestPriority;
  group: string | null;
  cancelToken: CancellationToken | null;
  createdAt: number;
  run: () => Promise<Result<unknown>>;
  resolve: (result: Result<unknown>) => void;
}

export interface EnqueueOptions {
  priority: RequestPriority;
  group?: string | undefined;
  cancelToken?: CancellationToken | undefined;
}

export interface RequestSchedulerOptions {
  fairnessThresholdMs: number;
}

export class RequestScheduler {
  private queue: Task[] = [];
  private running = false;
  private nextId = 1;
  private readonly clock: Clock;
  private readonly options: RequestSchedulerOptions;

  constructor(clock: Clock, options: RequestSchedulerOptions) {
    this.clock = clock;
    this.options = options;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  enqueue<T>(
    run: () => Promise<Result<T>>,
    options: EnqueueOptions,
  ): Promise<Result<T>> {
    return new Promise<Result<T>>((resolve) => {
      const task: Task = {
        id: this.nextId++,
        priority: options.priority,
        group: options.group ?? null,
        cancelToken: options.cancelToken ?? null,
        createdAt: this.clock.now(),
        run: run as () => Promise<Result<unknown>>,
        resolve: (result) => resolve(result as Result<T>),
      };
      this.queue.push(task);
      void this.drain();
    });
  }

  /** 取消尚未开始的同组任务；已执行中的任务不被中断。 */
  cancelGroup(group: string): void {
    for (const task of this.queue) {
      if (task.group === group && !task.cancelToken?.cancelled) {
        task.cancelToken?.cancel();
      }
    }
    void this.drain();
  }

  cancelAll(): void {
    for (const task of this.queue) {
      if (!task.cancelToken?.cancelled) {
        task.cancelToken?.cancel();
      }
    }
    void this.drain();
  }

  /** Remove cancelled queued tasks even while an unrelated exchange is running. */
  removeCancelled(): void {
    const cancelled = this.queue.filter((task) => task.cancelToken?.cancelled);
    this.queue = this.queue.filter((task) => !task.cancelToken?.cancelled);
    for (const task of cancelled) {
      task.resolve(
        fail(
          createMamepError({
            code: "CANCELLED",
            category: "cancellation",
            severity: "info",
            retryable: false,
            userMessageKey: "errors.cancelled",
            technicalMessage: task.cancelToken?.reason ?? "task cancelled",
          }),
        ),
      );
    }
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (true) {
        const task = this.pickNext();
        if (task === null) break;

        if (task.cancelToken?.cancelled) {
          task.resolve(
            fail(
              createMamepError({
                code: "CANCELLED",
                category: "cancellation",
                severity: "info",
                retryable: false,
                userMessageKey: "errors.cancelled",
                technicalMessage: task.cancelToken.reason ?? "task cancelled",
              }),
            ),
          );
          continue;
        }

        try {
          const result = await task.run();
          task.resolve(result);
        } catch (cause) {
          task.resolve(
            fail(
              createMamepError({
                code: "INTERNAL_ERROR",
                category: "internal",
                severity: "error",
                retryable: false,
                userMessageKey: "errors.internal",
                technicalMessage:
                  cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
            ),
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  private pickNext(): Task | null {
    // 清理已取消任务并立即 settle（cancelAll / cancelGroup 语义）。
    const alive: Task[] = [];
    for (const task of this.queue) {
      if (task.cancelToken?.cancelled) {
        task.resolve(
          fail(
            createMamepError({
              code: "CANCELLED",
              category: "cancellation",
              severity: "info",
              retryable: false,
              userMessageKey: "errors.cancelled",
              technicalMessage: task.cancelToken.reason ?? "task cancelled",
            }),
          ),
        );
      } else {
        alive.push(task);
      }
    }
    this.queue = alive;
    if (alive.length === 0) return null;

    const now = this.clock.now();

    // 公平性：等待超过阈值的任务按创建时间先执行。
    let starved: Task | null = null;
    for (const task of alive) {
      if (now - task.createdAt >= this.options.fairnessThresholdMs) {
        if (starved === null || task.createdAt < starved.createdAt)
          starved = task;
      }
    }
    if (starved !== null) {
      this.queue = alive.filter((t) => t !== starved);
      return starved;
    }

    let best: Task | null = null;
    for (const task of alive) {
      if (best === null) {
        best = task;
        continue;
      }
      const bestRank = PRIORITY_ORDER.indexOf(best.priority);
      const taskRank = PRIORITY_ORDER.indexOf(task.priority);
      if (
        taskRank < bestRank ||
        (taskRank === bestRank && task.createdAt < best.createdAt)
      ) {
        best = task;
      }
    }
    if (best !== null) {
      this.queue = alive.filter((t) => t !== best);
    }
    return best;
  }
}
