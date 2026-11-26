/**
 * Node worker_threads plugin bridge. Device requests use the host-bound activation API.
 * A Node thread is not an operating-system sandbox; this bridge does not restrict Node imports.
 */
import { Worker } from "node:worker_threads";
import type {
  PluginCommunicationApi,
  PluginManifest,
  PluginRemoteRuntime,
} from "@mamep2026/plugin-api";
import {
  pluginPermissionDenied,
  pluginWorkerEventSchema,
  type PluginWorkerEvent,
} from "@mamep2026/plugin-api";
import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";
import { PLUGIN_NODE_WORKER_BOOTSTRAP } from "./plugin-node-worker-bootstrap";

/** 通信面工厂：按插件 id 动态构造（消息携带真实 pluginId，日志正确记录）。 */
export type PluginCommunicationApiFactory = (
  pluginId: string,
) => PluginCommunicationApi;

export class NodePluginRemoteRuntime implements PluginRemoteRuntime {
  private readonly entrySource: string;
  private binding: { pluginId: string; api: PluginCommunicationApi } | null =
    null;
  private worker: Worker | null = null;
  private disposed = false;
  private invalidate: (() => void) | null = null;

  setInvalidationHandler(handler: () => void): void {
    this.invalidate = handler;
  }
  private waiters: Array<{ resolve: (value: PluginWorkerEvent) => void }> = [];

  constructor(
    entrySource: string,
    communicationApiFactory: PluginCommunicationApiFactory,
  ) {
    this.entrySource = entrySource;
    // Kept as a constructor compatibility argument; messages cannot select a factory.
    void communicationApiFactory;
  }

  async load(): Promise<Result<PluginManifest>> {
    if (this.disposed) {
      return fail(this.runtimeError("plugin runtime has been disposed"));
    }
    if (this.worker !== null) {
      return fail(this.runtimeError("plugin runtime already loaded"));
    }
    let worker: Worker;
    try {
      worker = new Worker(PLUGIN_NODE_WORKER_BOOTSTRAP, {
        eval: true,
      });
    } catch (err) {
      return fail(
        createMamepError({
          code: "PLUGIN_LOAD_FAILED",
          category: "plugin",
          userMessageKey: "errors.pluginLoadFailed",
          technicalMessage: `failed to create plugin worker thread: ${String(err)}`,
        }),
      );
    }
    this.worker = worker;
    worker.on("message", (message: unknown) => {
      this.handleWorkerMessage(message);
    });
    worker.on("error", (err: Error) => {
      this.waiter({ version: 1, type: "error", message: err.message });
      void this.dispose();
    });

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

  async dispose(): Promise<void> {
    const invalidate = this.invalidate;
    this.invalidate = null;
    invalidate?.();
    const worker = this.worker;
    this.worker = null;
    this.disposed = true;
    this.binding = null;
    for (const waiter of this.waiters.splice(0))
      waiter.resolve({
        version: 1,
        type: "error",
        message: "plugin runtime disposed",
      });
    if (worker !== null) {
      await worker.terminate();
    }
  }

  private async postAndWait(message: unknown): Promise<PluginWorkerEvent> {
    const worker = this.worker;
    if (worker === null) throw new Error("plugin worker not created");
    return await new Promise<PluginWorkerEvent>((resolve) => {
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
  }

  private waiter(fallback: PluginWorkerEvent): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(fallback);
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
      case "communication-request":
        void this.handleCommunicationRequest(event);
        return;
      case "ready":
      case "load-error":
      case "activated":
      case "deactivated":
      case "error":
        this.waiter(event);
        return;
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

/** 创建 Node 插件隔离运行时（Electron 主进程 / VSCode Extension Host 装配用）。 */
export function createNodePluginRemoteRuntime(
  entrySource: string,
  communicationApiFactory: PluginCommunicationApiFactory,
): PluginRemoteRuntime {
  return new NodePluginRemoteRuntime(entrySource, communicationApiFactory);
}
