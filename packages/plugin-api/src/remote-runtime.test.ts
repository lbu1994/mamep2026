import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@mamep2026/domain";
import { BoundedPluginRemoteRuntime } from "./remote-runtime";
import {
  PLUGIN_RUNTIME_LIMITS as limits,
  isPluginMessageWithinBudget,
} from "./runtime-limits";
import { PluginRegistry } from "./registry";
import { pluginManifestSchema } from "./manifest";

const manifest = pluginManifestSchema.parse({
  id: "bounded",
  name: "Bounded",
  description: "Lifecycle regression",
  version: "1.0.0",
  apiVersion: "2.0",
  platform: { web: true, node: false },
  permissions: ["communication"],
  contributes: {},
});
const runtimes: BoundedPluginRemoteRuntime[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  vi.useRealTimers();
});

function fixture(
  options: { silent?: string; throwSend?: boolean; source?: string } = {},
) {
  let receive: (input: unknown) => void = () => {};
  let crash: (error: Error) => void = () => {};
  const emit = (event: object) => receive({ version: 1, ...event });
  const terminate = vi.fn();
  const postMessage = vi.fn((input: unknown) => {
    if (options.throwSend) throw new Error("clone failed");
    const message = input as { type: string; id?: number };
    if (message.type === options.silent) return;
    if (message.type === "init") emit({ type: "ready", manifest });
    if (message.type === "activate") emit({ type: "activated" });
    if (message.type === "deactivate") emit({ type: "deactivated" });
    if (message.type === "ping") emit({ type: "pong", id: message.id });
  });
  const factory = vi.fn((onMessage, onError) => {
    receive = onMessage;
    crash = onError;
    return { postMessage, terminate };
  });
  const runtime = new BoundedPluginRemoteRuntime(
    options.source ?? "entry",
    factory,
  );
  runtimes.push(runtime);
  const api = {
    readRegisters: vi.fn(async () => ok([7])),
    writeRegisters: vi.fn(async () => ok(undefined)),
  };
  const request = (id: number) =>
    emit({
      type: "communication-request",
      id,
      op: "read",
      payload: { pluginId: manifest.id, req: { address: 0, quantity: 1 } },
    });
  const activate = () =>
    runtime.activate({ pluginId: manifest.id, communication: api });
  return {
    runtime,
    emit,
    crash: (message: string) => crash(new Error(message)),
    api,
    factory,
    postMessage,
    terminate,
    activate,
    request,
  };
}

describe("bounded plugin generation", () => {
  it("loads, activates, exchanges requests and heartbeats, then releases once", async () => {
    const f = fixture();
    expect((await f.runtime.load()).ok).toBe(true);
    await f.activate();
    f.request(1);
    await vi.advanceTimersByTimeAsync(limits.heartbeatIntervalMs * 3);
    expect(f.postMessage).toHaveBeenCalledWith({
      type: "communication-response",
      id: 1,
      result: ok([7]),
    });
    expect(f.terminate).not.toHaveBeenCalled();
    await f.runtime.deactivate();
    await f.runtime.dispose();
    expect(f.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["init", "activate", "deactivate"])(
    "terminates a silent %s hook within its deadline",
    async (silent) => {
      const f = fixture({ silent });
      if (silent === "init") {
        const load = f.runtime.load();
        await vi.advanceTimersByTimeAsync(limits.loadTimeoutMs);
        expect((await load).ok).toBe(false);
      } else {
        await f.runtime.load();
        if (silent === "activate") {
          const result = expect(f.activate()).rejects.toThrow("timed out");
          await vi.advanceTimersByTimeAsync(limits.activateTimeoutMs);
          await result;
        } else {
          await f.activate();
          const result = expect(f.runtime.deactivate()).rejects.toThrow(
            "timed out",
          );
          await vi.advanceTimersByTimeAsync(limits.deactivateTimeoutMs);
          await result;
        }
      }
      expect(f.terminate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["worker-error", "message-error", "hook-error"])(
    "fails an active runtime on %s without a waiter",
    async (kind) => {
      const f = fixture();
      await f.runtime.load();
      await f.activate();
      const invalidate = vi.fn();
      f.runtime.setInvalidationHandler(invalidate);
      if (kind === "hook-error")
        f.emit({ type: "error", message: "async failure" });
      else f.crash(kind);
      expect(invalidate).toHaveBeenCalledOnce();
      expect(f.terminate).toHaveBeenCalledOnce();
      f.request(1);
      expect(f.api.readRegisters).not.toHaveBeenCalled();
    },
  );

  it("settles a send failure and clears its deadline", async () => {
    const f = fixture({ throwSend: true });
    expect((await f.runtime.load()).ok).toBe(false);
    expect(f.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("terminates an unresponsive active Worker without restarting or replaying writes", async () => {
    const f = fixture({ silent: "ping" });
    await f.runtime.load();
    await f.activate();
    await vi.advanceTimersByTimeAsync(
      limits.heartbeatIntervalMs + limits.heartbeatTimeoutMs,
    );
    expect(f.terminate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.factory).toHaveBeenCalledOnce();
    expect(f.api.writeRegisters).not.toHaveBeenCalled();
    expect((await f.runtime.load()).ok).toBe(false);
  });

  it("stops immediately during activation and rejects the late activation reply", async () => {
    const f = fixture({ silent: "activate" });
    await f.runtime.load();
    const active = expect(f.activate()).rejects.toThrow("disposed");
    await f.runtime.deactivate();
    f.emit({ type: "activated" });
    f.request(1);
    await active;
    expect(f.api.readRegisters).not.toHaveBeenCalled();
    expect(f.postMessage).not.toHaveBeenCalledWith({ type: "deactivate" });
  });

  it("drops messages and pending results before waiting for deactivation", async () => {
    const f = fixture({ silent: "deactivate" });
    await f.runtime.load();
    await f.activate();
    let complete: (value: ReturnType<typeof ok<number[]>>) => void = () => {};
    f.api.readRegisters.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    f.request(1);
    const stop = expect(f.runtime.deactivate()).rejects.toThrow("timed out");
    f.request(2);
    complete(ok([99]));
    await vi.advanceTimersByTimeAsync(limits.deactivateTimeoutMs);
    await stop;
    expect(f.api.readRegisters).toHaveBeenCalledOnce();
    expect(
      f.postMessage.mock.calls.some(
        ([message]) =>
          (message as { type: string }).type === "communication-response",
      ),
    ).toBe(false);
  });

  it.each(["duplicate", "capacity", "deadline"])(
    "bounds pending requests: %s",
    async (mode) => {
      const f = fixture();
      await f.runtime.load();
      await f.activate();
      f.api.readRegisters.mockImplementation(() => new Promise(() => {}));
      f.request(1);
      if (mode === "duplicate") f.request(1);
      if (mode === "capacity")
        for (let id = 2; id <= limits.maxPendingRequests + 1; id++)
          f.request(id);
      if (mode === "deadline")
        await vi.advanceTimersByTimeAsync(limits.requestTimeoutMs);
      expect(f.api.readRegisters).toHaveBeenCalledTimes(
        mode === "capacity" ? limits.maxPendingRequests : 1,
      );
      expect(f.terminate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["rate", "bytes", "depth", "nodes"])(
    "rejects messages exceeding the %s budget",
    async (mode) => {
      const f = fixture();
      await f.runtime.load();
      await f.activate();
      if (mode === "rate")
        for (let id = 0; id <= limits.maxMessagesPerSecond; id++)
          f.emit({ type: "pong", id });
      if (mode === "bytes")
        f.emit({ type: "error", message: "x".repeat(limits.maxMessageBytes) });
      if (mode === "nodes")
        f.emit({
          type: "ready",
          manifest: Array.from({ length: limits.maxMessageNodes + 1 }, () => 0),
        });
      if (mode === "depth") {
        let value: unknown = 0;
        for (let depth = 0; depth <= limits.maxMessageDepth; depth++)
          value = { value };
        f.emit({ type: "ready", manifest: value });
      }
      expect(f.terminate).toHaveBeenCalledOnce();
    },
  );

  it("rejects large UTF-8 source before creating a Worker", async () => {
    const f = fixture({
      source: "\u4e2d".repeat(Math.ceil(limits.maxSourceBytes / 3)),
    });
    expect((await f.runtime.load()).ok).toBe(false);
    expect(f.factory).not.toHaveBeenCalled();
  });

  it("bounds Worker count and returns capacity after disposal", async () => {
    const live = Array.from({ length: limits.maxWorkers }, () => fixture());
    for (const f of live) expect((await f.runtime.load()).ok).toBe(true);
    const blocked = fixture();
    expect((await blocked.runtime.load()).ok).toBe(false);
    expect(blocked.factory).not.toHaveBeenCalled();
    await live[0]?.runtime.dispose();
    expect((await fixture().runtime.load()).ok).toBe(true);
  });

  it("does not let an old Worker failure or result affect a replacement registration", async () => {
    const registry = new PluginRegistry();
    const old = fixture();
    await old.runtime.load();
    registry.register(manifest, {
      source: "installed",
      remoteRuntime: old.runtime,
    });
    await vi.advanceTimersByTimeAsync(0);
    registry.unregister(manifest.id);
    const next = fixture();
    await next.runtime.load();
    registry.register(manifest, {
      source: "installed",
      remoteRuntime: next.runtime,
    });
    await vi.advanceTimersByTimeAsync(0);
    old.emit({ type: "error", message: "late old failure" });
    old.emit({ type: "activated" });
    old.request(1);
    expect(registry.isEnabled(manifest.id)).toBe(true);
    expect(registry.getLifecycleState(manifest.id)).toBe("active");
    expect(next.terminate).not.toHaveBeenCalled();
    await registry.dispose();
  });

  it("does not revive a ready reply after disposal in the same turn", async () => {
    const f = fixture();
    const pending = f.runtime.load();
    await f.runtime.dispose();
    expect((await pending).ok).toBe(false);
    await expect(f.activate()).rejects.toThrow();
  });

  it("rejects cycles and binary objects before schema validation", () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(isPluginMessageWithinBudget(cycle)).toBe(false);
    expect(isPluginMessageWithinBudget(new Uint8Array(8))).toBe(false);
    const shared = { value: 1 };
    expect(isPluginMessageWithinBudget([shared, shared])).toBe(true);
    expect(
      isPluginMessageWithinBudget({ version: 1, type: "ready", manifest }),
    ).toBe(true);
  });
});
