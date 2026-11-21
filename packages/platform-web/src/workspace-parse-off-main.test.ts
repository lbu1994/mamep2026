import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@mamep2026/domain";
import { parseWorkspace } from "@mamep2026/workspace";
import { serializeWorkspace } from "@mamep2026/workspace";
import { parseWorkspaceOffMainThread } from "./workspace-parse-off-main";
import {
  parseWorkspaceTextOffMainThread,
  WORKSPACE_PARSE_ABORTED,
} from "./workspace-parse-off-main";

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
    expect(terminate).toHaveBeenCalled();
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

  it("导入文本把 JSON.parse 也交给 Worker，主线程只接收已校验数据", async () => {
    let request: unknown;
    class FakeWorker {
      private message: ((event: MessageEvent<unknown>) => void) | null = null;

      constructor(_url: URL, _options?: WorkerOptions) {}

      addEventListener(
        type: string,
        listener: (event: MessageEvent<unknown>) => void,
      ): void {
        if (type === "message") this.message = listener;
      }

      postMessage(message: unknown): void {
        request = message;
        queueMicrotask(() => {
          this.message?.({
            data: {
              ok: true,
              value: JSON.parse(serializeWorkspace(workspace)),
            },
          } as MessageEvent<unknown>);
        });
      }

      terminate(): void {}
    }
    vi.stubGlobal("Worker", FakeWorker);

    const parsed = await parseWorkspaceTextOffMainThread(
      serializeWorkspace(workspace),
    );

    expect(request).toEqual({
      input: serializeWorkspace(workspace),
      inputKind: "json-text",
    });
    expect(parsed.ok).toBe(true);
  });

  it("取消会终止在途 Worker 并返回可识别的取消结果", async () => {
    const terminate = vi.fn();
    class PendingWorker {
      constructor(_url: URL, _options?: WorkerOptions) {}

      addEventListener(): void {}

      postMessage(): void {}

      terminate = terminate;
    }
    vi.stubGlobal("Worker", PendingWorker);
    const controller = new AbortController();

    const pending = parseWorkspaceTextOffMainThread(
      serializeWorkspace(workspace),
      { signal: controller.signal },
    );
    controller.abort();
    const parsed = await pending;

    expect(terminate).toHaveBeenCalled();
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe(WORKSPACE_PARSE_ABORTED);
    }
  });

  it("无 Worker 时非法 JSON 返回校验错误且不抛异常", async () => {
    vi.stubGlobal("Worker", undefined);

    const parsed = await parseWorkspaceTextOffMainThread("not-json{{{");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("WORKSPACE_SCHEMA_INVALID");
    }
  });
});
