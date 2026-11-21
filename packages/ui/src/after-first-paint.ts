import { startTransition, useEffect, useState } from "react";

/**
 * 首次启用后等待一帧再返回 true。
 *
 * 用于把通信日志/底部面板等非关键子树移出主界面首次 React commit。标签页隐藏时
 * `requestAnimationFrame` 不触发，因此用短暂定时器兜底。
 */
export function useAfterFirstPaint(enabled: boolean): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled || ready) return;
    let frame: number | null = null;
    const markReady = (): void => {
      startTransition(() => setReady(true));
    };
    const timer = setTimeout(markReady, 100);
    if (typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(markReady);
    }
    return () => {
      clearTimeout(timer);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled, ready]);

  return enabled && ready;
}
