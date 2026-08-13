/**
 * 时钟 Port（docs/AGENTS.md §8.2）：调度与超时必须通过 Clock 注入，
 * 禁止直接散落 setTimeout / Date.now，以便用 Virtual Clock 测试。
 * 真实实现（浏览器 setTimeout）在 platform-web 包中提供。
 */
export interface TimeoutHandle {
  cancel(): void;
}

export interface Clock {
  now(): number;
  schedule(callback: () => void, delayMs: number): TimeoutHandle;
}
