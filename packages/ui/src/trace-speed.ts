export const TRACE_INTERVAL_MIN_MS = 100;
export const TRACE_INTERVAL_MAX_MS = 2000;

/**
 * Speed 滑块左侧为 Quick、右侧为 Slow。
 * 0 → 100ms，100 → 2000ms；输入越靠近 Quick，采样间隔越短。
 */
export function traceSpeedToInterval(speed: number): number {
  const clamped = Math.min(100, Math.max(0, speed));
  return Math.round(
    TRACE_INTERVAL_MIN_MS +
      (clamped / 100) * (TRACE_INTERVAL_MAX_MS - TRACE_INTERVAL_MIN_MS),
  );
}
