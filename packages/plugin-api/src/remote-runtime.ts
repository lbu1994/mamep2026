import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";
import { pluginPermissionDenied } from "./authorization";
import type { PluginRemoteRuntime } from "./lifecycle";
import type { PluginManifest } from "./manifest";
import type { PluginCommunicationApi } from "./plugin-communication-api";
import {
  pluginWorkerEventSchema,
  type PluginWorkerEvent,
} from "./plugin-worker-message";
import {
  assertPluginSourceBudget,
  isPluginMessageWithinBudget,
  pluginRuntimeClock,
  type PluginRuntimeClock,
  PLUGIN_RUNTIME_LIMITS as limits,
} from "./runtime-limits";

/** Platform-owned endpoint. Termination must detach listeners before releasing the Worker. */
export interface PluginRuntimeEndpoint {
  postMessage(message: unknown): void;
  terminate(): void | Promise<void>;
}

type Phase =
  | "new"
  | "loading"
  | "loaded"
  | "activating"
  | "active"
  | "stopping"
  | "disposed";
type ReplyType = "ready" | "activated" | "deactivated";

/** One instance owns one Worker generation. Disposed instances cannot restart or replay requests. */
export class BoundedPluginRemoteRuntime implements PluginRemoteRuntime {
  private static workers = 0;
  private phase: Phase = "new";
  private endpoint: PluginRuntimeEndpoint | null = null;
  private slot = false;
  private binding: { pluginId: string; api: PluginCommunicationApi } | null =
    null;
  private invalidate: ((error?: Error) => void) | null = null;
  private failure: Error | undefined;
  private disposal: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private waiter: {
    expected: ReplyType;
    resolve: (event: PluginWorkerEvent) => void;
    reject: (error: Error) => void;
  } | null = null;
  private readonly requests = new Map<number, { cancel(): void }>();
  private heartbeat: { cancel(): void } | null = null;
  private heartbeatDeadline: { cancel(): void } | null = null;
  private heartbeatId = 0;
  private messageWindow = 0;
  private messageCount = 0;

  private readonly source: string;
  private readonly clock: PluginRuntimeClock;
  private readonly createEndpoint: (
    receive: (input: unknown) => void,
    fail: (error: Error) => void,
  ) => PluginRuntimeEndpoint;

  constructor(
    source: string,
    createEndpoint: (
      receive: (input: unknown) => void,
      fail: (error: Error) => void,
    ) => PluginRuntimeEndpoint,
    clock: PluginRuntimeClock = pluginRuntimeClock,
  ) {
    this.source = source;
    this.createEndpoint = createEndpoint;
    this.clock = clock;
  }

  setInvalidationHandler(handler: (error?: Error) => void): void {
    this.invalidate = handler;
  }

  async load(): Promise<Result<PluginManifest>> {
    if (this.phase !== "new")
      return fail(
        this.runtimeError("plugin runtime already loaded or disposed"),
      );
    this.phase = "loading";
    try {
      assertPluginSourceBudget(this.source);
      if (BoundedPluginRemoteRuntime.workers >= limits.maxWorkers)
        throw new Error("plugin worker limit exceeded");
      BoundedPluginRemoteRuntime.workers++;
      this.slot = true;
      this.endpoint = this.createEndpoint(
        (input) => this.receive(input),
        (error) => this.crash(error),
      );
      const ready = await this.postAndWait(
        { type: "init", entrySource: this.source },
        "ready",
        limits.loadTimeoutMs,
      );
      if (this.phase !== "loading") throw new Error("plugin load revoked");
      if (ready.type !== "ready")
        throw new Error("unexpected plugin load response");
      this.phase = "loaded";
      return ok(ready.manifest as PluginManifest);
    } catch (error) {
      await this.dispose();
      return fail(this.runtimeError(String(error)));
    }
  }

  async activate(ctx: {
    pluginId: string;
    communication: PluginCommunicationApi;
  }): Promise<void> {
    if (this.phase !== "loaded")
      throw new Error("plugin worker not ready for activation");
    this.phase = "activating";
    this.binding = { pluginId: ctx.pluginId, api: ctx.communication };
    try {
      await this.postAndWait(
        { type: "activate", pluginId: ctx.pluginId },
        "activated",
        limits.activateTimeoutMs,
      );
      if (this.phase !== "activating")
        throw new Error("plugin activation revoked");
      this.phase = "active";
      this.scheduleHeartbeat();
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  deactivate(): Promise<void> {
    if (this.stopping !== null) return this.stopping;
    const canStop = this.phase === "active";
    this.binding = null;
    this.clearTasks();
    if (!canStop) return this.dispose();
    this.phase = "stopping";
    // Notify the registry before plugin code can observe the stop command.
    const invalidate = this.invalidate;
    this.invalidate = null;
    invalidate?.();
    this.stopping = this.postAndWait(
      { type: "deactivate" },
      "deactivated",
      limits.deactivateTimeoutMs,
    )
      .then(() => undefined)
      .finally(() => this.dispose());
    return this.stopping;
  }

  dispose(): Promise<void> {
    if (this.disposal !== null) return this.disposal;
    // Mark terminal before callbacks, so registry invalidation cannot recurse into cleanup.
    this.phase = "disposed";
    this.binding = null;
    this.clearTasks();
    this.waiter?.reject(new Error("plugin runtime disposed"));
    this.waiter = null;
    const endpoint = this.endpoint;
    this.endpoint = null;
    let finish: () => void = () => {};
    let reject: (error: unknown) => void = () => {};
    this.disposal = new Promise<void>((resolve, fail) => {
      finish = resolve;
      reject = fail;
    });
    const invalidate = this.invalidate;
    this.invalidate = null;
    let notificationError: unknown;
    try {
      invalidate?.(this.failure);
    } catch (error) {
      notificationError = error;
    }
    // Calling terminate is unconditional, even if a host observer throws.
    try {
      Promise.resolve(endpoint?.terminate()).then(() => {
        this.releaseSlot();
        if (notificationError !== undefined) reject(notificationError);
        else finish();
      }, reject);
    } catch (error) {
      // Retain the slot if termination failed; a live Worker must still count against the budget.
      reject(error);
    }
    return this.disposal;
  }

  private releaseSlot(): void {
    if (!this.slot) return;
    this.slot = false;
    BoundedPluginRemoteRuntime.workers--;
  }

  private crash(error: Error): void {
    if (this.phase === "disposed") return;
    this.failure = error;
    this.waiter?.reject(error);
    void this.dispose();
  }

  private postAndWait(
    message: unknown,
    expected: ReplyType,
    timeoutMs: number,
  ): Promise<PluginWorkerEvent> {
    return new Promise((resolve, reject) => {
      if (this.endpoint === null || this.waiter !== null) {
        reject(new Error("plugin lifecycle request is unavailable"));
        return;
      }
      const timer = this.clock.schedule(
        () => this.crash(new Error(`plugin ${expected} timed out`)),
        timeoutMs,
      );
      this.waiter = {
        expected,
        resolve: (event) => {
          timer.cancel();
          this.waiter = null;
          resolve(event);
        },
        reject: (error) => {
          timer.cancel();
          this.waiter = null;
          reject(error);
        },
      };
      this.send(message);
    });
  }

  private send(message: unknown): void {
    try {
      this.endpoint?.postMessage(message);
    } catch (error) {
      this.crash(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private receive(input: unknown): void {
    if (this.phase === "disposed") return;
    const now = this.clock.now();
    if (now - this.messageWindow >= limits.messageWindowMs) {
      this.messageWindow = now;
      this.messageCount = 0;
    }
    if (
      ++this.messageCount > limits.maxMessagesPerSecond ||
      !isPluginMessageWithinBudget(input)
    ) {
      this.crash(new Error("plugin message budget exceeded"));
      return;
    }
    const parsed = pluginWorkerEventSchema.safeParse(input);
    if (!parsed.success) {
      this.crash(new Error("invalid plugin message"));
      return;
    }
    const event = parsed.data;
    if (event.type === "communication-request") {
      if (this.phase !== "stopping") void this.request(event);
      return;
    }
    if (event.type === "pong") {
      if (
        this.phase === "active" &&
        this.heartbeatDeadline !== null &&
        event.id === this.heartbeatId
      ) {
        this.heartbeatDeadline.cancel();
        this.heartbeatDeadline = null;
        this.scheduleHeartbeat();
      }
      return;
    }
    if (event.type === "error" || event.type === "load-error") {
      this.crash(new Error(event.message));
      return;
    }
    if (event.type !== this.waiter?.expected) {
      this.crash(new Error("unexpected plugin lifecycle response"));
      return;
    }
    this.waiter.resolve(event);
  }

  private async request(
    event: Extract<PluginWorkerEvent, { type: "communication-request" }>,
  ): Promise<void> {
    if (
      this.requests.has(event.id) ||
      this.requests.size >= limits.maxPendingRequests
    ) {
      this.crash(
        new Error(
          "plugin pending request limit exceeded or duplicate request ID",
        ),
      );
      return;
    }
    const binding = this.binding;
    const timer = this.clock.schedule(
      () => this.crash(new Error("plugin communication request timed out")),
      limits.requestTimeoutMs,
    );
    this.requests.set(event.id, timer);
    let result: Result<unknown>;
    try {
      if (binding === null || event.payload.pluginId !== binding.pluginId) {
        result = fail(
          pluginPermissionDenied("runtime identity is not authorized"),
        );
      } else {
        result =
          event.op === "read"
            ? await binding.api.readRegisters(event.payload.req)
            : await binding.api.writeRegisters(event.payload.req);
      }
    } catch (error) {
      result = fail(this.runtimeError(String(error)));
    } finally {
      timer.cancel();
      this.requests.delete(event.id);
    }
    if (
      this.phase !== "disposed" &&
      this.phase !== "stopping" &&
      this.binding === binding
    ) {
      this.send({ type: "communication-response", id: event.id, result });
    }
  }

  private scheduleHeartbeat(): void {
    this.heartbeat = this.clock.schedule(() => {
      this.heartbeat = null;
      this.heartbeatId++;
      this.heartbeatDeadline = this.clock.schedule(
        () => this.crash(new Error("plugin heartbeat timed out")),
        limits.heartbeatTimeoutMs,
      );
      this.send({ type: "ping", id: this.heartbeatId });
    }, limits.heartbeatIntervalMs);
  }

  private clearTasks(): void {
    if (this.heartbeat !== null) this.heartbeat.cancel();
    if (this.heartbeatDeadline !== null) this.heartbeatDeadline.cancel();
    this.heartbeat = null;
    this.heartbeatDeadline = null;
    for (const timer of this.requests.values()) timer.cancel();
    this.requests.clear();
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
