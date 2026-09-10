/**
 * Android 端 Clock（docs/AGENTS.md §8.2）：调度与超时必须经 Clock 注入，禁止散落 setTimeout。
 * 与 `platform-node` 的 real-clock 同义（WebView 与 Node 测试环境都提供 setTimeout/Date）。
 */
import type { Clock, TimeoutHandle } from "@mamep2026/communication";

interface TimerApi {
  setTimeout(handler: () => void, timeoutMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const timerApi = globalThis as unknown as TimerApi;

export const androidClock: Clock = {
  now: () => Date.now(),
  schedule(callback: () => void, delayMs: number): TimeoutHandle {
    const handle = timerApi.setTimeout(callback, delayMs);
    return {
      cancel: () => timerApi.clearTimeout(handle),
    };
  },
};
