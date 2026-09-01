/**
 * 浏览器 Web Worker 插件隔离运行时（ADR-044 Phase F-2，2026-09-01）。
 *
 * 实现 plugin-api 的 PluginRemoteRuntime：第三方单文件 JS 插件 entry 在 Web Worker
 * （Blob URL）中加载执行，经 postMessage 协议（见 plugin-worker-bootstrap.ts）与主线程
 * 隔离桥通信。插件唯一外部通道为 PluginCommunicationApi 代理——Worker 内发起的
 * readRegisters/writeRegisters 请求经消息往返到主线程注入的 communicationApi
 * （宿主装配为经统一 RequestScheduler 的真实通信面），响应回发 Worker。
 *
 * 安全边界：Worker 全局无 DOM / 无 Node API；插件 entry 须自包含（单文件，无外部 import）；
 * 加载/激活失败经 Result / 错误隔离（PLUGIN_LOAD_FAILED / PLUGIN_HOOK_FAILED）。
 */
import type { PluginManifest } from "@mamep2026/plugin-api";
import type {
  PluginCommunicationApi,
  PluginRemoteRuntime,
} from "@mamep2026/plugin-api";
import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";
import { PLUGIN_WORKER_BOOTSTRAP } from "./plugin-worker-bootstrap";

/** 通信面工厂：按插件 id 动态构造（Worker 消息携带真实 pluginId，日志正确记录）。 */
export type PluginCommunicationApiFactory = (
  pluginId: string,
) => PluginCommunicationApi;

/** Worker 工厂注入面（单测注入 fake；生产缺省用全局 Worker）。 */
export type PluginWorkerFactory = (scriptBlobUrl: string) => Worker;

function defaultWorkerFactory(scriptBlobUrl: string): Worker {
  return new Worker(scriptBlobUrl);
}

/** Worker → 主线程消息（插件侧事件）。 */
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
      payload: { pluginId: string; req: { address: number; quantity?: number; values?: number[] } };
    };

export class WebPluginRemoteRuntime implements PluginRemoteRuntime {
  private readonly entrySource: string;
  private readonly communicationApiFactory: PluginCommunicationApiFactory;
  private readonly workerFactory: PluginWorkerFactory;
  private worker: Worker | null = null;
  private disposed = false;
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
    this.communicationApiFactory = communicationApiFactory;
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
    let worker: Worker;
    try {
      const bootstrapUrl = URL.createObjectURL(
        new Blob([PLUGIN_WORKER_BOOTSTRAP], { type: "text/javascript" }),
      );
      worker = this.workerFactory(bootstrapUrl);
    } catch (err) {
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
      void this.handleWorkerMessage(event.data as PluginWorkerEvent);
    };
    worker.onerror = (event: ErrorEvent) => {
      this.waiter("error", { type: "error", message: event.message });
    };

    try {
      const ready = await this.postAndWait({ type: "init", entrySource: this.entrySource });
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
  async activate(ctx: { pluginId: string; communication: PluginCommunicationApi }): Promise<void> {
    if (this.worker === null) {
      throw new Error("plugin worker not loaded");
    }
    const event = await this.postAndWait({ type: "activate", pluginId: ctx.pluginId });
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

  /** 关闭隔离线程（terminate）。 */
  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.disposed = true;
    this.waiters = [];
    if (worker !== null) {
      worker.terminate();
    }
  }

  private async postAndWait(message: unknown): Promise<PluginWorkerEvent> {
    const worker = this.worker;
    if (worker === null) throw new Error("plugin worker not created");
    const result = await new Promise<PluginWorkerEvent>((resolve) => {
      this.waiters.push({ resolve });
      worker.postMessage(message);
    });
    return result;
  }

  /** 出队第一个 waiter 并 resolve（协议为 FIFO：init → ready → activate → activated）。 */
  private waiter(fallbackType: PluginWorkerEvent["type"], fallback: PluginWorkerEvent): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(fallback);
    } else if (fallbackType === "error") {
      // 无等待者时的异步错误（Worker 崩溃）：无法上抛，静默（dispose 由调用方兜底）。
    }
  }

  private handleWorkerMessage(event: PluginWorkerEvent): void {
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

/** 创建浏览器插件隔离运行时（entrySource = 单文件 JS 插件源码）。 */
export function createWebPluginRemoteRuntime(
  entrySource: string,
  communicationApiFactory: PluginCommunicationApiFactory,
  options: { workerFactory?: PluginWorkerFactory } = {},
): PluginRemoteRuntime {
  return new WebPluginRemoteRuntime(entrySource, communicationApiFactory, options);
}
