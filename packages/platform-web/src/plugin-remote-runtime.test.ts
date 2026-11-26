/**
 * WebPluginRemoteRuntime 单测。
 * jsdom 无真 Worker：注入 fake Worker 驱动 postMessage 协议，覆盖
 * load（ready/load-error）、activate（activated/error）、communication 桥、
 * dispose/terminate、Worker 崩溃错误隔离。
 */
import { describe, expect, it, vi } from "vitest";
import {
  WebPluginRemoteRuntime,
  type PluginWorkerFactory,
} from "./plugin-remote-runtime";

interface FakeWorker {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/** 构造行为可编程的 fake Worker 工厂。 */
function fakeWorkerFactory(
  behavior: (msg: Record<string, unknown>) => void,
  workerRef?: { current: FakeWorker | null },
): PluginWorkerFactory {
  return (_scriptBlobUrl: string): Worker => {
    const fake: FakeWorker = {
      postMessage: vi.fn((msg: Record<string, unknown>) => {
        behavior(msg);
      }),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    if (workerRef) workerRef.current = fake;
    return fake as unknown as Worker;
  };
}

/** 触发 fake worker 的 onmessage（把消息从「主线程侧」注入 runtime）。 */
function emit(fake: FakeWorker, event: Record<string, unknown>): void {
  fake.onmessage?.({ data: { version: 1, ...event } } as MessageEvent);
}

describe("WebPluginRemoteRuntime（ADR-044 Phase F-2）", () => {
  it("load：init → ready，返回 manifest；worker 已创建（blob URL）", async () => {
    const workerRef: { current: FakeWorker | null } = { current: null };
    const factory = fakeWorkerFactory((msg) => {
      if (msg.type === "init") {
        emit(workerRef.current!, {
          type: "ready",
          manifest: {
            id: "exec",
            name: "Exec",
            version: "1.0.0",
            apiVersion: "2.0",
            platform: { web: true, node: false },
            permissions: [],
            contributes: {},
          },
        });
      }
    }, workerRef);

    const runtime = new WebPluginRemoteRuntime(
      "export const manifest = {};",
      () => ({ readRegisters: vi.fn(), writeRegisters: vi.fn() }),
      { workerFactory: factory },
    );
    const result = await runtime.load();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("exec");
    // Worker 以 bootstrap Blob URL 创建。
    expect(workerRef.current?.postMessage).toHaveBeenCalledWith({
      type: "init",
      entrySource: "export const manifest = {};",
    });
    await runtime.dispose();
  });

  it("load：load-error → 返回 PLUGIN_LOAD_FAILED 并关闭 Worker", async () => {
    const workerRef: { current: FakeWorker | null } = { current: null };
    const factory = fakeWorkerFactory((msg) => {
      if (msg.type === "init") {
        emit(workerRef.current!, {
          type: "load-error",
          message: "entry must export a manifest",
        });
      }
    }, workerRef);

    const runtime = new WebPluginRemoteRuntime(
      "export const x = 1;",
      () => ({ readRegisters: vi.fn(), writeRegisters: vi.fn() }),
      { workerFactory: factory },
    );
    const result = await runtime.load();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PLUGIN_LOAD_FAILED");
    expect(workerRef.current?.terminate).toHaveBeenCalled();
  });

  it("activate：activate → activated；失败 → 抛错（PLUGIN_HOOK_FAILED 隔离由 registry 承接）", async () => {
    const workerRef: { current: FakeWorker | null } = { current: null };
    let mode: "ok" | "fail" = "ok";
    const factory = fakeWorkerFactory((msg) => {
      const fake = workerRef.current!;
      if (msg.type === "init") {
        emit(fake, {
          type: "ready",
          manifest: {
            id: "x",
            platform: { web: true, node: false },
            permissions: [],
            contributes: {},
          },
        });
      } else if (msg.type === "activate") {
        emit(
          fake,
          mode === "ok"
            ? { type: "activated" }
            : { type: "error", message: "boom" },
        );
      }
    }, workerRef);

    const runtime = new WebPluginRemoteRuntime(
      "export const manifest = {};",
      () => ({ readRegisters: vi.fn(), writeRegisters: vi.fn() }),
      { workerFactory: factory },
    );
    expect((await runtime.load()).ok).toBe(true);
    await runtime.activate({
      pluginId: "x",
      communication: { readRegisters: vi.fn(), writeRegisters: vi.fn() },
    });

    mode = "fail";
    const runtime2 = new WebPluginRemoteRuntime(
      "export const manifest = {};",
      () => ({ readRegisters: vi.fn(), writeRegisters: vi.fn() }),
      { workerFactory: factory },
    );
    expect((await runtime2.load()).ok).toBe(true);
    await expect(
      runtime2.activate({
        pluginId: "x",
        communication: { readRegisters: vi.fn(), writeRegisters: vi.fn() },
      }),
    ).rejects.toThrow("boom");
  });

  it("communication 桥：Worker 读/写请求经注入的通信面执行并回发响应", async () => {
    const workerRef: { current: FakeWorker | null } = { current: null };
    const factory = fakeWorkerFactory((msg) => {
      const fake = workerRef.current!;
      if (msg.type === "init") {
        emit(fake, {
          type: "ready",
          manifest: {
            id: "x",
            platform: { web: true, node: false },
            permissions: [],
            contributes: {},
          },
        });
      } else if (msg.type === "activate") {
        // 插件 activate 期间发起读请求 → 主线程桥执行 → 回发响应。
        emit(fake, {
          type: "communication-request",
          id: 1,
          op: "read",
          payload: { pluginId: "x", req: { address: 0x100, quantity: 2 } },
        });
        emit(fake, { type: "activated" });
      }
    }, workerRef);

    const readRegisters = vi.fn(async () => ({
      ok: true as const,
      value: [0x1234, 0x5678],
    }));
    const runtime = new WebPluginRemoteRuntime(
      "export const manifest = {};",
      () => ({ readRegisters, writeRegisters: vi.fn() }),
      { workerFactory: factory },
    );
    expect((await runtime.load()).ok).toBe(true);
    await runtime.activate({
      pluginId: "x",
      communication: { readRegisters, writeRegisters: vi.fn() },
    });

    expect(readRegisters).toHaveBeenCalledWith({ address: 0x100, quantity: 2 });
    // 响应回发 Worker（含 read 结果）。
    const response = workerRef.current!.postMessage.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { type?: string }).type === "communication-response",
    );
    expect(response?.[0]).toEqual({
      type: "communication-response",
      id: 1,
      result: { ok: true, value: [0x1234, 0x5678] },
    });
  });

  it("dispose：terminate + 清空等待者；二次 load 报错", async () => {
    const workerRef: { current: FakeWorker | null } = { current: null };
    const factory = fakeWorkerFactory((msg) => {
      if (msg.type === "init") {
        emit(workerRef.current!, {
          type: "ready",
          manifest: {
            id: "x",
            platform: { web: true, node: false },
            permissions: [],
            contributes: {},
          },
        });
      }
    }, workerRef);

    const runtime = new WebPluginRemoteRuntime(
      "export const manifest = {};",
      () => ({ readRegisters: vi.fn(), writeRegisters: vi.fn() }),
      { workerFactory: factory },
    );
    expect((await runtime.load()).ok).toBe(true);
    const fake = workerRef.current!;
    await runtime.dispose();
    expect(fake.terminate).toHaveBeenCalled();
    // dispose 后 load 报错。
    const again = await runtime.load();
    expect(again.ok).toBe(false);
  });

  it("Worker onerror（崩溃）→ 待处理 load 以 error 落定（错误隔离）", async () => {
    const workerRef: { current: FakeWorker | null } = { current: null };
    const factory = fakeWorkerFactory(() => {
      // 不响应 init：等待 load 挂起，然后触发 onerror。
      queueMicrotask(() => {
        workerRef.current?.onerror?.({
          message: "worker crashed",
        } as ErrorEvent);
      });
    }, workerRef);

    const runtime = new WebPluginRemoteRuntime(
      "export const manifest = {};",
      () => ({ readRegisters: vi.fn(), writeRegisters: vi.fn() }),
      { workerFactory: factory },
    );
    const result = await runtime.load();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PLUGIN_LOAD_FAILED");
  });
});

describe("untrusted plugin messages", () => {
  function fixture() {
    const ref: { current: FakeWorker | null } = { current: null };
    const api = {
      readRegisters: vi.fn(async () => ({ ok: true as const, value: [7] })),
      writeRegisters: vi.fn(async () => ({
        ok: true as const,
        value: undefined,
      })),
    };
    const factory = vi.fn(() => api);
    const runtime = new WebPluginRemoteRuntime(
      "export const manifest = {};",
      factory,
      {
        workerFactory: fakeWorkerFactory((message) => {
          if (message.type === "init" && ref.current)
            emit(ref.current, { type: "ready", manifest: { id: "owner" } });
          if (message.type === "activate" && ref.current)
            emit(ref.current, { type: "activated" });
          if (message.type === "deactivate" && ref.current)
            emit(ref.current, { type: "deactivated" });
        }, ref),
      },
    );
    const send = (pluginId: string, op = "read") => {
      if (ref.current)
        emit(ref.current, {
          type: "communication-request",
          id: 1,
          op,
          payload: { pluginId, req: { address: 0, quantity: 1 } },
        });
    };
    return { ref, api, factory, runtime, send };
  }

  it("rejects pre-activation requests and forged IDs without selecting an API factory", async () => {
    const f = fixture();
    await f.runtime.load();
    f.send("owner");
    expect(f.api.readRegisters).not.toHaveBeenCalled();
    await f.runtime.activate({ pluginId: "owner", communication: f.api });
    f.send("victim");
    expect(f.api.readRegisters).not.toHaveBeenCalled();
    f.send("owner");
    expect(f.api.readRegisters).toHaveBeenCalledTimes(1);
    expect(f.factory).not.toHaveBeenCalled();
    await f.runtime.deactivate();
    f.send("owner");
    expect(f.api.readRegisters).toHaveBeenCalledTimes(1);
    await f.runtime.dispose();
  });

  it.each(["unknown", "WRITE", "read-all"])(
    "rejects unknown operation %s instead of treating it as write",
    async (op) => {
      const f = fixture();
      await f.runtime.load();
      await f.runtime.activate({ pluginId: "owner", communication: f.api });
      f.send("owner", op);
      expect(f.api.readRegisters).not.toHaveBeenCalled();
      expect(f.api.writeRegisters).not.toHaveBeenCalled();
      expect(f.ref.current?.terminate).toHaveBeenCalled();
    },
  );

  it("settles a load when the host disposes it before readiness", async () => {
    const runtime = new WebPluginRemoteRuntime(
      "",
      () => ({ readRegisters: vi.fn(), writeRegisters: vi.fn() }),
      { workerFactory: fakeWorkerFactory(() => {}) },
    );
    const pending = runtime.load();
    await runtime.dispose();
    expect((await pending).ok).toBe(false);
  });
});
