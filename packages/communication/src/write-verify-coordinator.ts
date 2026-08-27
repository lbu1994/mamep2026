/**
 * 写后回读协调器（docs/TECH_DESIGN.md §15.3、docs/AGENTS.md §18.2）。
 *
 * 把写入与回读视为相关但独立的两个阶段：write → optional-delay → verify-read → compare。
 * - 写入失败：直接返回失败（写入阶段结论不可被回读阶段修改）；
 * - 配置 OFF：write-succeeded-no-verify；
 * - 延迟等待使用可取消时钟（Clock port，注入 Virtual Clock 测试，禁止散落 setTimeout）；
 * - 延迟中 / 回读被取消：cancelled-before-verify（写入已成功仅回读取消，不显示失败态）；
 * - 回读失败：write-succeeded-verify-failed（携带错误码/用户消息 key，仍属写入成功）；
 * - 回读成功：按读回值比较产出 matched / mismatched。
 *
 * 写入与回读均经同一 CommunicationSession 的统一调度器串行执行（docs/AGENTS.md §13）。
 */
import { ok, type ReadVerifySettings, type Result } from "@mamep2026/domain";
import {
  createCancellationToken,
  type CancellationToken,
} from "./cancellation";
import type { Clock, TimeoutHandle } from "./clock";
import type { CommunicationSession, WriteOutcome } from "./session";

export interface WriteVerifyMeta {
  /** 用户输入地址（Address Adjust 之前的地址，日志用）。 */
  userAddress?: number;
  /** 外部取消令牌（2026-08-26）：延迟中取消 → cancelled-before-verify；缺省仅受 disconnect 影响。 */
  cancelToken?: CancellationToken;
}

export class WriteVerifyCoordinator {
  private readonly session: CommunicationSession;
  private readonly clock: Clock;

  constructor(session: CommunicationSession, clock: Clock) {
    this.session = session;
    this.clock = clock;
  }

  /** 写后回读全流程（单寄存器，ADR-030 后委托多值实现，values=[rawValue]）。 */
  async writeWithVerify(
    sentAddress: number,
    rawValue: number,
    settings: ReadVerifySettings,
    meta: WriteVerifyMeta = {},
  ): Promise<Result<WriteOutcome>> {
    return this.writeWithVerifyMany(sentAddress, [rawValue], settings, meta);
  }

  /**
   * 写后回读全流程（多寄存器，ADR-030）：一次 FC0x10 写 values 全部，回读 FC03 读 N 个
   * 连续寄存器并逐项比较。settings.mode==="off" 时不回读（默认写入成功即成功态）。
   */
  async writeWithVerifyMany(
    sentAddress: number,
    values: number[],
    settings: ReadVerifySettings,
    meta: WriteVerifyMeta = {},
  ): Promise<Result<WriteOutcome>> {
    // 阶段 1：写入（FC0x10，多值）。
    const writeResult = await this.session.writeRegisters(sentAddress, values, {
      source: "manual-write",
      ...(meta.userAddress !== undefined
        ? { userAddress: meta.userAddress }
        : {}),
    });
    if (!writeResult.ok) return writeResult;

    // 未启用回读：保持既有行为（write-succeeded-no-verify）。
    if (settings.mode === "off") {
      return ok({ kind: "write-succeeded-no-verify" });
    }

    // 取消令牌贯穿延迟与回读：延迟中取消立即结束（cancelled-before-verify），
    // 回读任务携带同一令牌（disconnect/scheduler.cancelAll 会取消它）。
    const cancelToken = createCancellationToken();
    // 外部取消（未来 UI 取消入口，ADR-025 模式）联动内部令牌。
    const unsubscribeExternal =
      meta.cancelToken?.onCancel(() =>
        cancelToken.cancel("write-verify-cancelled"),
      ) ?? null;
    try {
      return await this.runVerify(
        sentAddress,
        values,
        settings,
        cancelToken,
        meta,
      );
    } finally {
      unsubscribeExternal?.();
    }
  }

  /** 写成功后执行可选延迟与回读比较（settings.mode 已排除 off）。 */
  private async runVerify(
    sentAddress: number,
    values: number[],
    settings: ReadVerifySettings,
    cancelToken: CancellationToken,
    meta: WriteVerifyMeta,
  ): Promise<Result<WriteOutcome>> {
    // 阶段 2：可选延迟（可取消时钟）。
    if (
      settings.mode === "delayed" &&
      settings.delayMs !== null &&
      settings.delayMs > 0
    ) {
      const cancelledDuringDelay = await this.waitCancellable(
        settings.delayMs,
        cancelToken,
      );
      if (cancelledDuringDelay) {
        return ok({ kind: "cancelled-before-verify" });
      }
    }

    // 阶段 3：回读（FC03，同一 sentAddress，quantity=values.length；来源 write-verify）。
    const readResult = await this.session.readRegisters(
      sentAddress,
      values.length,
      {
        source: "write-verify",
        ...(meta.userAddress !== undefined
          ? { userAddress: meta.userAddress }
          : {}),
        cancelToken,
      },
    );
    if (!readResult.ok) {
      // 回读被取消（disconnect / 调度器取消）：写入已成功仅回读取消。
      if (readResult.error.code === "CANCELLED") {
        return ok({ kind: "cancelled-before-verify" });
      }
      // 回读失败：写入成功结论不变（§18.2）。
      return ok({
        kind: "write-succeeded-verify-failed",
        errorCode: readResult.error.code,
        userMessageKey: readResult.error.userMessageKey,
      });
    }

    // 阶段 4：逐项比较。
    const readValues = readResult.value;
    const matched =
      readValues.length === values.length &&
      readValues.every((value, index) => value === values[index]);
    if (matched) {
      return ok({ kind: "write-succeeded-verify-matched", readValues });
    }
    return ok({
      kind: "write-succeeded-verify-mismatched",
      expectedValues: values,
      readValues,
    });
  }

  /** 可取消延迟：时钟调度等待；令牌取消时立即返回 true（表示延迟中被取消）。 */
  private waitCancellable(
    delayMs: number,
    token: CancellationToken,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      if (token.cancelled) {
        resolve(true);
        return;
      }
      let timer: TimeoutHandle | null = null;
      let settled = false;
      const finish = (cancelled: boolean): void => {
        if (settled) return;
        settled = true;
        unsubscribe();
        timer?.cancel();
        resolve(cancelled);
      };
      const unsubscribe = token.onCancel(() => finish(true));
      timer = this.clock.schedule(() => finish(token.cancelled), delayMs);
    });
  }
}
