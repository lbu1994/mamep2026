/**
 * 插件执行能力运行时探测单测（2026-09-13，ADR-056）。
 * jsdom 无真 Worker：注入 fake Worker 驱动 postMessage 协议 + 手工时钟，
 * 覆盖「可用 → true」「Worker 报错 → false」「超时 → false」「工厂抛错 → false」
 * 与「无论结果都 terminate Worker、都取消计时器」。
 */
import { describe, expect, it, vi } from "vitest";
import type { Clock } from "@mamep2026/communication";
import {
  PLUGIN_EXECUTION_PROBE_ENTRY,
  probePluginExecutionSupport,
} from "./plugin-execution-probe";
import type { PluginWorkerFactory } from "./plugin-remote-runtime";

interface FakeWorker {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/** fake Worker 工厂：`behavior` 在收到主线程消息时调用（可回发消息模拟 Worker 行为）。 */
function fakeWorkerFactory(
  behavior: (msg: Record<string, unknown>) => void,
  workerRef?: { current: FakeWorker | null },
): PluginWorkerFactory {
  return (): Worker => {
    const fake: FakeWorker = {
      postMessage: vi.fn((msg: Record<string, unknown>) => behavior(msg)),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    if (workerRef) workerRef.current = fake;
    return fake as unknown as Worker;
  };
}

/** 把消息从「Worker 侧」注入运行时。 */
function emit(fake: FakeWorker, event: Record<string, unknown>): void {
  fake.onmessage?.({ data: event } as MessageEvent);
}

/** 手工时钟：捕获 schedule 回调，由用例决定何时超时（并记录 cancel 次数）。 */
function manualClock(): {
  clock: Clock;
  fire: () => void;
  cancelledCount: () => number;
} {
  const scheduled: Array<() => void> = [];
  let cancelled = 0;
  return {
    clock: {
      now: () => 0,
      schedule: (callback: () => void) => {
        scheduled.push(callback);
        return {
          cancel: () => {
            cancelled += 1;
          },
        };
      },
    },
    fire: () => {
      for (const callback of scheduled) callback();
    },
    cancelledCount: () => cancelled,
  };
}

describe("probePluginExecutionSupport（ADR-056）", () => {
  it("Worker 成功加载 blob entry → true，并 terminate（不留线程）", async () => {
    const workerRef: { current: FakeWorker | null } = { current: null };
    const factory = fakeWorkerFactory((msg) => {
      if (msg.type === "init") {
        emit(workerRef.current!, {
          type: "ready",
          manifest: { id: "probe" },
        });
      }
    }, workerRef);
    const clock = manualClock();

    await expect(
      probePluginExecutionSupport({
        workerFactory: factory,
        clock: clock.clock,
      }),
    ).resolves.toBe(true);
    expect(workerRef.current?.terminate).toHaveBeenCalledTimes(1);
    // 探测用 entry 经 init 消息下发（与生产同一加载路径）。
    expect(workerRef.current?.postMessage).toHaveBeenCalledWith({
      type: "init",
      entrySource: PLUGIN_EXECUTION_PROBE_ENTRY,
    });
    // 探测成功也取消计时器，不留下悬挂定时器。
    expect(clock.cancelledCount()).toBe(1);
  });

  it("Worker 报 load-error（如 blob import 被拦）→ false，并 terminate", async () => {
    const workerRef: { current: FakeWorker | null } = { current: null };
    const factory = fakeWorkerFactory((msg) => {
      if (msg.type === "init") {
        emit(workerRef.current!, {
          type: "load-error",
          message: "Loading the script 'blob:...' violates CSP",
        });
      }
    }, workerRef);

    await expect(
      probePluginExecutionSupport({
        workerFactory: factory,
        clock: manualClock().clock,
      }),
    ).resolves.toBe(false);
    expect(workerRef.current?.terminate).toHaveBeenCalledTimes(1);
  });

  it("Worker 无响应 → 超时 false，并 terminate", async () => {
    const workerRef: { current: FakeWorker | null } = { current: null };
    // 收到 init 后不回发任何消息：模拟内核静默不执行。
    const factory = fakeWorkerFactory(() => undefined, workerRef);
    const clock = manualClock();

    const pending = probePluginExecutionSupport({
      workerFactory: factory,
      clock: clock.clock,
      timeoutMs: 1234,
    });
    clock.fire();

    await expect(pending).resolves.toBe(false);
    expect(workerRef.current?.terminate).toHaveBeenCalledTimes(1);
    expect(clock.cancelledCount()).toBe(1);
  });

  it("Worker 创建抛错 → false（探测绝不抛出）", async () => {
    const factory: PluginWorkerFactory = () => {
      throw new Error("Failed to construct 'Worker'");
    };

    await expect(
      probePluginExecutionSupport({
        workerFactory: factory,
        clock: manualClock().clock,
      }),
    ).resolves.toBe(false);
  });
});
