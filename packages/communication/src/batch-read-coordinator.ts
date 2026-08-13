/**
 * 全表读取协调器（docs/TECH_DESIGN.md §14、docs/AGENTS.md §15）。
 * 一次性批量读取：快照、跳过非法行、单行失败继续、可取消尚未执行的任务、输出汇总。
 */
import { ok, type Result } from "@mamep2026/domain";
import { createCancellationToken } from "./cancellation";
import type { Clock } from "./clock";
import type { CommunicationSession } from "./session";

export interface BatchReadRow {
  key: string;
  /** null 表示地址为空或非法，将被跳过。 */
  address: number | null;
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
  key: string,
  result: Result<number>,
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
  ): BatchReadHandle {
    const batchId = `batch-${++this.seq}`;
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
            batchId,
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
        void this.session
          .readRegister(row.address ?? 0, {
            source: "batch-read",
            priority: "batch-read",
            group: batchId,
            cancelToken,
          })
          .then((result) => {
            onRowResult?.(row.key, result);
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
