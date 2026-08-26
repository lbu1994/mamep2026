/**
 * 取消令牌（docs/AGENTS.md §12.4）。
 * 取消已发送的请求只表示软件停止等待，不保证设备没有执行操作。
 */
export interface CancellationToken {
  readonly cancelled: boolean;
  readonly reason: string | null;
  cancel(reason?: string): void;
  /** 订阅取消回调（已取消时立即调用）；返回退订函数。2026-08-26 写后回读延迟等待用。 */
  onCancel(listener: () => void): () => void;
}

export function createCancellationToken(): CancellationToken {
  let cancelled = false;
  let reason: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get cancelled() {
      return cancelled;
    },
    get reason() {
      return reason;
    },
    cancel(cancelReason = "cancelled") {
      if (!cancelled) {
        cancelled = true;
        reason = cancelReason;
        for (const listener of [...listeners]) listener();
      }
    },
    onCancel(listener) {
      if (cancelled) {
        listener();
        return () => undefined;
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
