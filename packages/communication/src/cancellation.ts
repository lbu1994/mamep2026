/**
 * 取消令牌（docs/AGENTS.md §12.4）。
 * 取消已发送的请求只表示软件停止等待，不保证设备没有执行操作。
 */
export interface CancellationToken {
  readonly cancelled: boolean;
  readonly reason: string | null;
  cancel(reason?: string): void;
}

export function createCancellationToken(): CancellationToken {
  let cancelled = false;
  let reason: string | null = null;
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
      }
    },
  };
}
