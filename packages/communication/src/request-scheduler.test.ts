import { describe, expect, it } from "vitest";
import type { Clock } from "./clock";
import { createCancellationToken } from "./cancellation";
import { RequestScheduler } from "./request-scheduler";

/** 测试用虚拟时钟：手动推进时间，任务按调度顺序执行。 */
class ManualClock implements Clock {
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

  /** 推进时间并触发到期定时器（按到期顺序）。 */
  advance(ms: number): void {
    this.nowValue += ms;
    const due = this.timers
      .filter((t) => t.dueAt <= this.nowValue)
      .sort((a, b) => a.dueAt - b.dueAt);
    this.timers = this.timers.filter((t) => t.dueAt > this.nowValue);
    for (const timer of due) timer.callback();
  }
}

/** 推进时钟并在每步之间 flush microtask，让异步 drain 有机会注册下一个定时器。 */
async function advanceUntil(
  clock: ManualClock,
  predicate: () => boolean,
  step = 5,
  maxSteps = 200,
): Promise<void> {
  for (let i = 0; i < maxSteps && !predicate(); i++) {
    clock.advance(step);
    await Promise.resolve();
    await Promise.resolve();
  }
}

function makeDelayedTask(clock: ManualClock, ms: number, value: number) {
  return () =>
    new Promise<{ ok: true; value: number }>((resolve) => {
      clock.schedule(() => resolve({ ok: true, value }), ms);
    });
}

describe("RequestScheduler", () => {
  it("executes only one task at a time", async () => {
    const clock = new ManualClock();
    const scheduler = new RequestScheduler(clock, {
      fairnessThresholdMs: 1000,
      getInterRequestDelayMs: () => 0,
    });

    let active = 0;
    let maxActive = 0;
    const run = () =>
      new Promise<{ ok: true; value: number }>((resolve) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        clock.schedule(() => {
          active -= 1;
          resolve({ ok: true, value: 0 });
        }, 10);
      });

    const p1 = scheduler.enqueue(run, { priority: "manual-read" });
    const p2 = scheduler.enqueue(run, { priority: "manual-read" });
    await advanceUntil(
      clock,
      () => active === 0 && scheduler.pendingCount === 0,
    );
    await Promise.all([p1, p2]);
    expect(maxActive).toBe(1);
  });

  it("runs higher priority tasks before lower priority ones", async () => {
    const clock = new ManualClock();
    const scheduler = new RequestScheduler(clock, {
      fairnessThresholdMs: 10_000,
      getInterRequestDelayMs: () => 0,
    });
    const order: string[] = [];

    // 先用一个慢任务占用调度器，让后续三个任务全部进入等待队列。
    const blocker = scheduler.enqueue(makeDelayedTask(clock, 50, 0), {
      priority: "connection-control",
    });
    const p3 = scheduler
      .enqueue(makeDelayedTask(clock, 5, 0), { priority: "polling" })
      .then(() => order.push("polling"));
    const p1 = scheduler
      .enqueue(makeDelayedTask(clock, 5, 0), { priority: "manual-read" })
      .then(() => order.push("manual"));
    const p2 = scheduler
      .enqueue(makeDelayedTask(clock, 5, 0), { priority: "batch-read" })
      .then(() => order.push("batch"));

    await advanceUntil(clock, () => order.length === 3);
    await Promise.all([blocker, p1, p2, p3]);
    expect(order).toEqual(["manual", "batch", "polling"]);
  });

  it("does not starve low priority tasks forever (fairness)", async () => {
    const clock = new ManualClock();
    // 公平阈值 20ms：低优先级任务等待超过阈值后按 FIFO 执行。
    const scheduler = new RequestScheduler(clock, {
      fairnessThresholdMs: 20,
      getInterRequestDelayMs: () => 0,
    });
    const order: string[] = [];

    const pPoll = scheduler
      .enqueue(makeDelayedTask(clock, 10, 0), { priority: "polling" })
      .then(() => order.push("poll-1"));
    const pManual = scheduler
      .enqueue(makeDelayedTask(clock, 10, 0), { priority: "manual-read" })
      .then(() => order.push("manual-1"));
    const pPoll2 = scheduler
      .enqueue(makeDelayedTask(clock, 10, 0), { priority: "polling" })
      .then(() => order.push("poll-2"));

    await advanceUntil(clock, () => order.length === 3);
    await Promise.all([pPoll, pManual, pPoll2]);
    expect(order).toContain("poll-1");
    expect(order).toContain("poll-2");
  });

  it("resolves cancelled queued tasks with a cancellation error", async () => {
    const clock = new ManualClock();
    const scheduler = new RequestScheduler(clock, {
      fairnessThresholdMs: 1000,
      getInterRequestDelayMs: () => 0,
    });

    const token = createCancellationToken();
    const long = scheduler.enqueue(makeDelayedTask(clock, 50, 1), {
      priority: "manual-read",
    });
    const queued = scheduler.enqueue(makeDelayedTask(clock, 5, 2), {
      priority: "manual-read",
      cancelToken: token,
    });

    token.cancel();
    await advanceUntil(clock, () => scheduler.pendingCount === 0);
    const [a, b] = await Promise.all([long, queued]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error.code).toBe("CANCELLED");
  });

  it("applies the inter-request delay between tasks", async () => {
    const clock = new ManualClock();
    const scheduler = new RequestScheduler(clock, {
      fairnessThresholdMs: 1000,
      getInterRequestDelayMs: () => 50,
    });
    const timestamps: number[] = [];

    const p1 = scheduler.enqueue(
      () => {
        timestamps.push(clock.now());
        return Promise.resolve({ ok: true as const, value: 1 });
      },
      { priority: "manual-read" },
    );
    const p2 = scheduler.enqueue(
      () => {
        timestamps.push(clock.now());
        return Promise.resolve({ ok: true as const, value: 2 });
      },
      { priority: "manual-read" },
    );

    await advanceUntil(clock, () => timestamps.length === 2);
    await Promise.all([p1, p2]);
    expect(timestamps).toHaveLength(2);
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(50);
  });

  it("cleans cancelled queued tasks from the pending count", async () => {
    const clock = new ManualClock();
    const scheduler = new RequestScheduler(clock, {
      fairnessThresholdMs: 1000,
      getInterRequestDelayMs: () => 0,
    });
    const token = createCancellationToken();
    scheduler.enqueue(makeDelayedTask(clock, 50, 0), {
      priority: "polling",
      group: "g",
      cancelToken: token,
    });
    token.cancel();
    await advanceUntil(clock, () => scheduler.pendingCount === 0);
    expect(scheduler.pendingCount).toBe(0);
  });
});
