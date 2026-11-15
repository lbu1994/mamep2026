/**
 * 全表读取协调器（docs/TECH_DESIGN.md §14、docs/AGENTS.md §15）。
 * 一次性批量读取：快照、跳过非法行、单行失败继续、可取消尚未执行的任务、输出汇总。
 */
import {
  ok,
  type PollResultContext,
  type RequestRoute,
  type Result,
} from "@mamep2026/domain";
import { createCancellationToken } from "./cancellation";
import type { Clock } from "./clock";
import type { CommunicationSession } from "./session";

export interface BatchReadRow {
  key: string;
  /** 行所属表；结果事件据此校验页面绑定。 */
  sheetId: string;
  /** null 表示地址为空或非法，将被跳过。 */
  address: number | null;
  /** 覆盖的连续寄存器数（ADR-030）：缺省/1=单寄存器；>1 时一次 FC03 读全部。 */
  quantity?: number;
}

export interface BatchReadSummary {
  batchId: string;
  totalRows: number;
  eligibleRows: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  cancelledCount: number;
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

export interface BatchReadHandle {
  promise: Promise<Result<BatchReadSummary>>;
  cancel: () => void;
}

export type BatchRowResultListener = (
  event: PollResultContext & { result: Result<number | number[]> },
) => void;

export class BatchReadCoordinator {
  private seq = 0;
  private readonly session: CommunicationSession;
  private readonly clock: Clock;

  constructor(session: CommunicationSession, clock: Clock) {
    this.session = session;
    this.clock = clock;
  }

  readAll(
    rows: BatchReadRow[],
    onRowResult?: BatchRowResultListener,
    batchId?: string,
    route?: RequestRoute,
    requestGeneration = 0,
  ): BatchReadHandle {
    // 显式 batchId 用于远程路径（渲染端生成随请求传入，ADR-025），保证汇总 batchId
    // 与请求关联一致；本地路径缺省时内部自增生成。
    const resolvedBatchId = batchId ?? `batch-${++this.seq}`;
    const resolvedRoute = route ? { ...route } : this.session.getCurrentRoute();
    const cancelToken = createCancellationToken();
    const eligible = rows.filter((row) => row.address !== null);
    const skippedCount = rows.length - eligible.length;
    const startedAt = this.clock.now();

    let successCount = 0;
    let failureCount = 0;
    let cancelledCount = 0;
    let completed = 0;

    const promise = new Promise<Result<BatchReadSummary>>((resolve) => {
      const finish = (): void => {
        if (completed < eligible.length) return;
        const completedAt = this.clock.now();
        resolve(
          ok({
            batchId: resolvedBatchId,
            totalRows: rows.length,
            eligibleRows: eligible.length,
            successCount,
            failureCount,
            skippedCount,
            cancelledCount,
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
          }),
        );
      };

      if (eligible.length === 0) {
        finish();
        return;
      }

      for (const row of eligible) {
        const quantity = row.quantity ?? 1;
        // 多寄存器行（ADR-030）：一次 FC03 读全部连续寄存器，结果携带 values[]。
        const request =
          quantity > 1
            ? this.session.readRegisters(row.address ?? 0, quantity, {
                source: "batch-read",
                priority: "batch-read",
                group: resolvedBatchId,
                cancelToken,
                route: resolvedRoute,
              })
            : this.session.readRegister(row.address ?? 0, {
                source: "batch-read",
                priority: "batch-read",
                group: resolvedBatchId,
                cancelToken,
                route: resolvedRoute,
              });
        void request.then((result) => {
          onRowResult?.({
            key: row.key,
            sheetId: row.sheetId,
            address: row.address ?? 0,
            route: { ...resolvedRoute },
            requestGeneration,
            result,
          });
          if (result.ok) successCount += 1;
          else if (result.error.code === "CANCELLED") cancelledCount += 1;
          else failureCount += 1;
          completed += 1;
          finish();
        });
      }
    });

    return {
      promise,
      cancel: () => cancelToken.cancel("batch-cancelled"),
    };
  }
}
