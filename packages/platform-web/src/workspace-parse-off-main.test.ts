import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@mamep2026/domain";
import { parseWorkspace } from "@mamep2026/workspace";
import { serializeWorkspace } from "@mamep2026/workspace";
import { parseWorkspaceOffMainThread } from "./workspace-parse-off-main";
import {
  disposeWorkspaceWorker,
  parseWorkspaceTextOffMainThread,
  serializeWorkspaceOffMainThread,
  warmWorkspaceParser,
  WORKSPACE_PARSE_ABORTED,
} from "./workspace-parse-off-main";

const workspace = createEmptyWorkspace();
const stored = JSON.parse(serializeWorkspace(workspace)) as unknown;

afterEach(() => {
  disposeWorkspaceWorker();
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

  it("Worker 返回已校验领域快照，主线程不再逐行重建", async () => {
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

      postMessage(message: unknown): void {
        const { id } = message as { id: number };
        const data = JSON.parse(serializeWorkspace(workspace)) as unknown;
        const parsed = parseWorkspace(data);
        if (!parsed.ok) throw new Error("fixture is invalid");
        queueMicrotask(() => {
          this.listeners.get("message")?.({
            data: {
              id,
              result: {
                ok: true,
                value: {
                  workspace: parsed.value,
                  data,
                  serialized: serializeWorkspace(parsed.value),
                },
              },
            },
          } as MessageEvent<unknown>);
        });
      }

      terminate(): void {}
    }
    vi.stubGlobal("Worker", FakeWorker);

    const parsed = await parseWorkspaceOffMainThread({ schemaVersion: 999 });

    expect(parsed.ok).toBe(true);
    expect(parsed).toEqual(parseWorkspace(stored));
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
        const { id } = message as { id: number };
        const parsed = parseWorkspace(
          JSON.parse(serializeWorkspace(workspace)),
        );
        if (!parsed.ok) throw new Error("fixture is invalid");
        queueMicrotask(() => {
          this.message?.({
            data: {
              id,
              result: {
                ok: true,
                value: {
                  workspace: parsed.value,
                  data: JSON.parse(serializeWorkspace(workspace)),
                  serialized: serializeWorkspace(parsed.value),
                },
              },
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

    expect(request).toMatchObject({
      kind: "parse",
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

  it("保存快照经 Worker 完成完整校验并复用同一原始数据对象", async () => {
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
        const { id } = message as { id: number };
        const data = JSON.parse(serializeWorkspace(workspace)) as unknown;
        queueMicrotask(() => {
          this.message?.({
            data: {
              id,
              result: {
                ok: true,
                value: { data, serialized: JSON.stringify(data) },
              },
            },
          } as MessageEvent<unknown>);
        });
      }

      terminate(): void {}
    }
    vi.stubGlobal("Worker", FakeWorker);

    const snapshot = await serializeWorkspaceOffMainThread(workspace);

    expect(request).toMatchObject({ kind: "serialize", input: workspace });
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) {
      expect(snapshot.value.data).toEqual(
        JSON.parse(serializeWorkspace(workspace)),
      );
      expect(snapshot.value.serialized).toBe(serializeWorkspace(workspace));
    }
  });

  it("可预热 Worker 且复用同一实例", async () => {
    let created = 0;
    class FakeWorker {
      private message: ((event: MessageEvent<unknown>) => void) | null = null;

      constructor(_url: URL, _options?: WorkerOptions) {
        created += 1;
      }

      addEventListener(
        type: string,
        listener: (event: MessageEvent<unknown>) => void,
      ): void {
        if (type === "message") this.message = listener;
      }

      postMessage(message: unknown): void {
        const { id } = message as { id: number };
        queueMicrotask(() => {
          this.message?.({
            data: { id, result: { ok: true, value: { warm: true } } },
          } as MessageEvent<unknown>);
        });
      }

      terminate(): void {}
    }
    vi.stubGlobal("Worker", FakeWorker);

    expect((await warmWorkspaceParser()).ok).toBe(true);
    expect((await warmWorkspaceParser()).ok).toBe(true);
    expect(created).toBe(1);
  });
});
