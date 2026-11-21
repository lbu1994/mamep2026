import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@mamep2026/domain";
import { parseWorkspace } from "@mamep2026/workspace";
import { serializeWorkspace } from "@mamep2026/workspace";
import { parseWorkspaceOffMainThread } from "./workspace-parse-off-main";

const workspace = createEmptyWorkspace();
const stored = JSON.parse(serializeWorkspace(workspace)) as unknown;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseWorkspaceOffMainThread", () => {
  it("无 Worker 环境回退同步解析且保持领域对象语义", async () => {
    vi.stubGlobal("Worker", undefined);

    const expected = parseWorkspace(stored);
    const actual = await parseWorkspaceOffMainThread(stored);

    expect(actual).toEqual(expected);
    expect(actual.ok).toBe(true);
  });

  it("Worker 返回校验数据后仅重建领域对象并终止 Worker", async () => {
    const terminate = vi.fn();
    class FakeWorker {
      private readonly listeners = new Map<
        string,
        (event: MessageEvent<unknown>) => void
      >();

      constructor(_url: URL, _options?: WorkerOptions) {}

      addEventListener(
        type: string,
        listener: (event: MessageEvent<unknown>) => void,
      ): void {
        this.listeners.set(type, listener);
      }

      postMessage(_message: unknown): void {
        const data = JSON.parse(serializeWorkspace(workspace)) as unknown;
        queueMicrotask(() => {
          this.listeners.get("message")?.({
            data: { ok: true, value: data },
          } as MessageEvent<unknown>);
        });
      }

      terminate = terminate;
    }
    vi.stubGlobal("Worker", FakeWorker);

    const parsed = await parseWorkspaceOffMainThread({ schemaVersion: 999 });

    expect(parsed.ok).toBe(true);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("Worker 创建失败时回退原解析路径", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("worker blocked");
        }
      },
    );

    const parsed = await parseWorkspaceOffMainThread(stored);

    expect(parsed).toEqual(parseWorkspace(stored));
  });
});
