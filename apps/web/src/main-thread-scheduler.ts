/**
 * 启动阶段的主线程调度工具。
 *
 * 非关键初始化必须等到首屏至少完成一次绘制后再执行；阶段之间也主动让出宏任务，
 * 避免工作区恢复、插件恢复和 React 提交被压进同一个 Long Task。
 */

export type AfterPaintScheduler = (task: () => void) => () => void;

/**
 * 在浏览器完成下一次绘制后执行任务。
 *
 * 双重 `requestAnimationFrame` 确保 Store 更新触发的 React commit 已经进入当前帧；
 * `setTimeout` 兜底覆盖标签页隐藏或其他无法触发动画帧的环境。返回取消函数，
 * 供 StrictMode 卸载/重新装配使用。
 */
export const scheduleAfterPaint: AfterPaintScheduler = (task) => {
  let cancelled = false;
  let firstFrame: number | null = null;
  let secondFrame: number | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const run = (): void => {
    if (cancelled) return;
    cancelled = true;
    if (fallbackTimer !== null) clearTimeout(fallbackTimer);
    task();
  };

  if (typeof requestAnimationFrame === "function") {
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(run);
    });
    fallbackTimer = setTimeout(run, 100);
  } else {
    fallbackTimer = setTimeout(run, 0);
  }

  return () => {
    cancelled = true;
    if (firstFrame !== null) cancelAnimationFrame(firstFrame);
    if (secondFrame !== null) cancelAnimationFrame(secondFrame);
    if (fallbackTimer !== null) clearTimeout(fallbackTimer);
  };
};

/**
 * 把一个长启动阶段拆成多个宏任务。优先使用浏览器 Scheduler API；
 * 不支持时退回 `setTimeout(0)`，保证 React/输入事件有机会插入。
 */
export function yieldToMainThread(): Promise<void> {
  const scheduler = (
    globalThis as typeof globalThis & {
      scheduler?: {
        yield?: () => Promise<void>;
      };
    }
  ).scheduler;
  if (typeof scheduler?.yield === "function") {
    return scheduler.yield().catch(() => undefined);
  }
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
