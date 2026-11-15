/**
 * Node worker_threads 插件隔离运行时。
 *
 * 实现 plugin-api 的 PluginRemoteRuntime：第三方单文件 JS 插件 entry 在 worker_threads
 * （eval module，见 plugin-node-worker-bootstrap.ts）中加载执行，经与浏览器端一致的
 * postMessage 协议与主线程隔离桥通信。Electron 主进程 / VSCode Extension Host 装配用。
 *
 * 安全边界：worker_threads 内插件代码无宿主全局（electron / vscode / 主进程能力），
 * 唯一外部通道为 PluginCommunicationApi 代理桥（read/write 经统一调度器）。
 */
import { Worker } from "node:worker_threads";
import type {
  PluginCommunicationApi,
  PluginManifest,
  PluginRemoteRuntime,
} from "@mamep2026/plugin-api";
import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";
import { PLUGIN_NODE_WORKER_BOOTSTRAP } from "./plugin-node-worker-bootstrap";

/** 通信面工厂：按插件 id 动态构造（消息携带真实 pluginId，日志正确记录）。 */
export type PluginCommunicationApiFactory = (
  pluginId: string,
) => PluginCommunicationApi;

type PluginWorkerEvent =
  | { type: "ready"; manifest: unknown }
  | { type: "load-error"; message: string }
  | { type: "activated" }
  | { type: "deactivated" }
  | { type: "error"; message: string }
  | {
      type: "communication-request";
      id: number;
      op: "read" | "write";
      payload: {
        pluginId: string;
        req: { address: number; quantity?: number; values?: number[] };
      };
    };

export class NodePluginRemoteRuntime implements PluginRemoteRuntime {
  private readonly entrySource: string;
  private readonly communicationApiFactory: PluginCommunicationApiFactory;
  private worker: Worker | null = null;
  private disposed = false;
  private waiters: Array<{ resolve: (value: PluginWorkerEvent) => void }> = [];

  constructor(
    entrySource: string,
    communicationApiFactory: PluginCommunicationApiFactory,
  ) {
    this.entrySource = entrySource;
    this.communicationApiFactory = communicationApiFactory;
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
    worker.on("message", (message: PluginWorkerEvent) => {
      this.handleWorkerMessage(message);
    });
    worker.on("error", (err: Error) => {
      this.waiter({ type: "error", message: err.message });
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
    if (this.worker === null) return;
    const event = await this.postAndWait({ type: "deactivate" });
    if (event.type === "error") {
      throw new Error(event.message);
    }
  }

  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.disposed = true;
    this.waiters = [];
    if (worker !== null) {
      await worker.terminate();
    }
  }

  private async postAndWait(message: unknown): Promise<PluginWorkerEvent> {
    const worker = this.worker;
    if (worker === null) throw new Error("plugin worker not created");
    return await new Promise<PluginWorkerEvent>((resolve) => {
      this.waiters.push({ resolve });
      worker.postMessage(message);
    });
  }

  private waiter(fallback: PluginWorkerEvent): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(fallback);
    }
  }

  private handleWorkerMessage(event: PluginWorkerEvent): void {
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
    const { id, op, payload } = event;
    const api = this.communicationApiFactory(payload.pluginId);
    let result: Result<unknown>;
    if (op === "read") {
      result = await api.readRegisters({
        address: payload.req.address,
        quantity: payload.req.quantity ?? 1,
      });
    } else {
      result = await api.writeRegisters({
        address: payload.req.address,
        values: payload.req.values ?? [],
      });
    }
    this.worker?.postMessage({
      type: "communication-response",
      id,
      result: result.ok
        ? { ok: true, value: result.value }
        : { ok: false, error: result.error },
    });
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
