/**
 * 测试用虚拟时钟（与 request-scheduler.test 中的一致实现）。
 */
import type { Clock } from "../clock";

export class ManualClock implements Clock {
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

/** 推进时钟并在每步 flush microtask，让异步链路有时间注册下一个定时器。 */
export async function advanceUntil(
  clock: ManualClock,
  predicate: () => boolean,
  step = 5,
  maxSteps = 400,
): Promise<void> {
  for (let i = 0; i < maxSteps && !predicate(); i++) {
    clock.advance(step);
    await Promise.resolve();
    await Promise.resolve();
  }
}
