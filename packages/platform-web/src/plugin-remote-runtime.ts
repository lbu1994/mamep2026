/**
 * Web plugin bridge. The default factory creates a Worker inside an opaque-origin iframe.
 * Only a host-bound activation API may submit device requests; all incoming events are validated.
 */
import type { PluginManifest } from "@mamep2026/plugin-api";
import type {
  PluginCommunicationApi,
  PluginRemoteRuntime,
} from "@mamep2026/plugin-api";
import {
  createUnavailableCommunicationApi,
  pluginPermissionDenied,
  pluginWorkerEventSchema,
  type PluginWorkerEvent,
} from "@mamep2026/plugin-api";
import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";
import {
  createSandboxedPluginWorker,
  type PluginWorkerEndpoint,
} from "./plugin-sandbox-worker";
import { PLUGIN_WORKER_BOOTSTRAP } from "./plugin-worker-bootstrap";

/** Legacy factory argument retained for source compatibility; activation supplies the bound API. */
export type PluginCommunicationApiFactory = (
  pluginId: string,
) => PluginCommunicationApi;

/** Injectable Worker endpoint; production uses a Worker owned by an opaque-origin iframe. */
export type PluginWorkerFactory = (
  scriptBlobUrl: string,
) => PluginWorkerEndpoint;

function defaultWorkerFactory(_scriptBlobUrl: string): PluginWorkerEndpoint {
  return createSandboxedPluginWorker(PLUGIN_WORKER_BOOTSTRAP);
}

/** Worker → 主线程消息（插件侧事件）。 */
export class WebPluginRemoteRuntime implements PluginRemoteRuntime {
  private readonly entrySource: string;
  private binding: { pluginId: string; api: PluginCommunicationApi } | null =
    null;
  private readonly workerFactory: PluginWorkerFactory;
  private worker: PluginWorkerEndpoint | null = null;
  private disposed = false;
  private invalidate: (() => void) | null = null;

  setInvalidationHandler(handler: () => void): void {
    this.invalidate = handler;
  }
  private bootstrapUrl: string | null = null;
  /** 待处理消息队列：init/activate/deactivate 的 resolve（按消息顺序 FIFO）。 */
  private waiters: Array<{
    resolve: (value: PluginWorkerEvent) => void;
  }> = [];

  constructor(
    entrySource: string,
    communicationApiFactory: PluginCommunicationApiFactory,
    options: { workerFactory?: PluginWorkerFactory } = {},
  ) {
    this.entrySource = entrySource;
    // Kept as a constructor compatibility argument; messages cannot select a factory.
    void communicationApiFactory;
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
  }

  /** 创建 Worker 并加载 entry，提取 manifest（隔离线程 import + 序列化回主线程）。 */
  async load(): Promise<Result<PluginManifest>> {
    if (this.disposed) {
      return fail(this.runtimeError("plugin runtime has been disposed"));
    }
    if (this.worker !== null) {
      return fail(this.runtimeError("plugin runtime already loaded"));
    }
    let worker: PluginWorkerEndpoint;
    try {
      const bootstrapUrl = URL.createObjectURL(
        new Blob([PLUGIN_WORKER_BOOTSTRAP], { type: "text/javascript" }),
      );
      this.bootstrapUrl = bootstrapUrl;
      worker = this.workerFactory(bootstrapUrl);
    } catch (err) {
      await this.dispose();
      return fail(
        createMamepError({
          code: "PLUGIN_LOAD_FAILED",
          category: "plugin",
          userMessageKey: "errors.pluginLoadFailed",
          technicalMessage: `failed to create plugin worker: ${String(err)}`,
        }),
      );
    }
    this.worker = worker;
    worker.onmessage = (event: MessageEvent) => {
      this.handleWorkerMessage(event.data);
    };
    worker.onerror = (event: ErrorEvent) => {
      this.waiter("error", {
        version: 1,
        type: "error",
        message: event.message,
      });
      void this.dispose();
    };

    try {
      const ready = await this.postAndWait({
        type: "init",
        entrySource: this.entrySource,
      });
      if (ready.type === "load-error") {
        await this.dispose();
        return fail(
          createMamepError({
            code: "PLUGIN_LOAD_FAILED",
            category: "plugin",
            userMessageKey: "errors.pluginLoadFailed",
            technicalMessage: ready.message,
          }),
        );
      }
      if (ready.type !== "ready") {
        await this.dispose();
        return fail(this.runtimeError("unexpected worker message during load"));
      }
      return ok(ready.manifest as PluginManifest);
    } catch (err) {
      await this.dispose();
      return fail(
        createMamepError({
          code: "PLUGIN_LOAD_FAILED",
          category: "plugin",
          userMessageKey: "errors.pluginLoadFailed",
          technicalMessage: String(err),
        }),
      );
    }
  }

  /** 在隔离线程执行插件 activate（通信面为跨线程代理）。 */
  async activate(ctx: {
    pluginId: string;
    communication: PluginCommunicationApi;
  }): Promise<void> {
    if (this.worker === null) {
      throw new Error("plugin worker not loaded");
    }
    this.binding = { pluginId: ctx.pluginId, api: ctx.communication };
    const event = await this.postAndWait({
      type: "activate",
      pluginId: ctx.pluginId,
    });
    if (event.type === "error") {
      throw new Error(event.message);
    }
    if (event.type !== "activated") {
      throw new Error("unexpected worker message during activate");
    }
  }

  async deactivate(): Promise<void> {
    this.binding = null;
    if (this.worker === null) return;
    const event = await this.postAndWait({ type: "deactivate" });
    if (event.type === "error") {
      throw new Error(event.message);
    }
  }

  /** 关闭隔离线程（terminate）。 */
  async dispose(): Promise<void> {
    const invalidate = this.invalidate;
    this.invalidate = null;
    invalidate?.();
    const worker = this.worker;
    this.worker = null;
    if (this.bootstrapUrl !== null) URL.revokeObjectURL(this.bootstrapUrl);
    this.bootstrapUrl = null;
    this.disposed = true;
    this.binding = null;
    for (const waiter of this.waiters.splice(0))
      waiter.resolve({
        version: 1,
        type: "error",
        message: "plugin runtime disposed",
      });
    if (worker !== null) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
  }

  private async postAndWait(message: unknown): Promise<PluginWorkerEvent> {
    const worker = this.worker;
    if (worker === null) throw new Error("plugin worker not created");
    const result = await new Promise<PluginWorkerEvent>((resolve) => {
      const timer = setTimeout(() => {
        void this.dispose();
      }, 10000);
      this.waiters.push({
        resolve: (event) => {
          clearTimeout(timer);
          resolve(event);
        },
      });
      worker.postMessage(message);
    });
    return result;
  }

  /** 出队第一个 waiter 并 resolve（协议为 FIFO：init → ready → activate → activated）。 */
  private waiter(
    fallbackType: PluginWorkerEvent["type"],
    fallback: PluginWorkerEvent,
  ): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(fallback);
    } else if (fallbackType === "error") {
      // 无等待者时的异步错误（Worker 崩溃）：无法上抛，静默（dispose 由调用方兜底）。
    }
  }

  private handleWorkerMessage(input: unknown): void {
    if (this.disposed) return;
    const parsed = pluginWorkerEventSchema.safeParse(input);
    if (!parsed.success) {
      this.binding = null;
      void this.dispose();
      return;
    }
    const event = parsed.data;
    switch (event.type) {
      case "communication-request": {
        // 插件通信代理桥：主线程注入的通信面执行后回发响应。
        void this.handleCommunicationRequest(event);
        return;
      }
      case "ready":
      case "load-error":
      case "activated":
      case "deactivated":
      case "error": {
        this.waiter(event.type, event);
        return;
      }
    }
  }

  private async handleCommunicationRequest(
    event: Extract<PluginWorkerEvent, { type: "communication-request" }>,
  ): Promise<void> {
    const binding = this.binding;
    const worker = this.worker;
    let result: Result<unknown>;
    if (binding === null || event.payload.pluginId !== binding.pluginId) {
      result = fail(
        pluginPermissionDenied("runtime identity is not authorized"),
      );
    } else {
      try {
        result =
          event.op === "read"
            ? await binding.api.readRegisters(event.payload.req)
            : await binding.api.writeRegisters(event.payload.req);
      } catch (error) {
        result = fail(this.runtimeError(String(error)));
      }
    }
    if (worker !== null && this.worker === worker && this.binding === binding) {
      worker.postMessage({
        type: "communication-response",
        id: event.id,
        result,
      });
    }
  }

  private runtimeError(technicalMessage: string) {
    return createMamepError({
      code: "PLUGIN_LOAD_FAILED",
      category: "plugin",
      userMessageKey: "errors.pluginLoadFailed",
      technicalMessage,
    });
  }
}

/** 创建浏览器插件隔离运行时（entrySource = 单文件 JS 插件源码）。 */
export function createWebPluginRemoteRuntime(
  entrySource: string,
  communicationApiFactory: PluginCommunicationApiFactory,
  options: { workerFactory?: PluginWorkerFactory } = {},
): PluginRemoteRuntime {
  return new WebPluginRemoteRuntime(
    entrySource,
    communicationApiFactory,
    options,
  );
}

/** Preview has no activation, device API, or application storage access. */
export function createWebPluginPreviewRuntime(
  entrySource: string,
  options: { workerFactory?: PluginWorkerFactory } = {},
): Pick<PluginRemoteRuntime, "load" | "dispose"> {
  const runtime = new WebPluginRemoteRuntime(
    entrySource,
    createUnavailableCommunicationApi,
    options,
  );
  return {
    load: () => runtime.load(),
    dispose: () => runtime.dispose(),
  };
}
