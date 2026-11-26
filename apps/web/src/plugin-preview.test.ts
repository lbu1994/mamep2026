// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import type { CommunicationLogEvent } from "@mamep2026/communication";
import { InMemoryWorkspaceRepository } from "@mamep2026/test-kit";
import { pluginManifestSchema } from "@mamep2026/plugin-api";
import type { PluginWorkerFactory } from "@mamep2026/platform-web";
import { BrowserAppHost } from "./AppHost";

type Endpoint = ReturnType<PluginWorkerFactory>;
const state = vi.hoisted(() => ({
  workers: [] as Array<Endpoint & { sent: unknown[]; terminated: boolean }>,
  ready: true,
}));

const manifest = pluginManifestSchema.parse({
  id: "preview-attack",
  name: "Preview attack",
  description: "Preview lifecycle regression",
  version: "1.0.0",
  apiVersion: "2.0",
  platform: { web: true, node: false },
  permissions: ["communication", "device-write"],
});

function emit(worker: Endpoint, data: unknown): void {
  worker.onmessage?.(new MessageEvent("message", { data }));
}

function request(worker: Endpoint, op: "read" | "write", id: number): void {
  emit(worker, {
    version: 1,
    type: "communication-request",
    id,
    op,
    payload: {
      pluginId: manifest.id,
      req:
        op === "read"
          ? { address: 0, quantity: 1 }
          : { address: 0, values: [123] },
    },
  });
}

const factory: PluginWorkerFactory = () => {
  const worker: (typeof state.workers)[number] = {
    onmessage: null,
    onerror: null,
    sent: [],
    terminated: false,
    terminate() {
      this.terminated = true;
    },
    postMessage(message: { type: string }) {
      this.sent.push(message);
      if (message.type === "init") {
        // Malicious top-level code sends both operations before publishing its manifest.
        request(this, "read", 1);
        request(this, "write", 2);
        if (state.ready) emit(this, { version: 1, type: "ready", manifest });
      }
      if (message.type === "activate")
        emit(this, { version: 1, type: "activated" });
    },
  };
  state.workers.push(worker);
  return worker;
};

vi.mock("@mamep2026/platform-web", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@mamep2026/platform-web")>();
  return {
    ...original,
    createWebPluginPreviewRuntime: (source: string) =>
      original.createWebPluginPreviewRuntime(source, {
        workerFactory: factory,
      }),
    createWebPluginRemoteRuntime: (
      source: string,
      api: Parameters<typeof original.createWebPluginRemoteRuntime>[1],
    ) =>
      original.createWebPluginRemoteRuntime(source, api, {
        workerFactory: factory,
      }),
    hashPluginContent: async () => "a".repeat(64),
  };
});

beforeEach(() => {
  state.workers.length = 0;
  state.ready = true;
  let urlNumber = 0;
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = vi.fn(
        () => `blob:preview-${++urlNumber}`,
      );
      static override revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const host = new BrowserAppHost({
    platform: null,
    repository: new InMemoryWorkspaceRepository(),
    mockTransport: true,
  });
  const logs: CommunicationLogEvent[] = [];
  host.subscribeCommLog((event) => logs.push(event));
  return { host, logs };
}

function expectReleased(worker: (typeof state.workers)[number]): void {
  expect(worker.terminated).toBe(true);
  expect(worker.onmessage).toBeNull();
  expect(worker.onerror).toBeNull();
  expect(worker.sent).toContainEqual({
    type: "communication-response",
    id: 1,
    result: {
      ok: false,
      error: expect.objectContaining({ code: "PLUGIN_PERMISSION_DENIED" }),
    },
  });
  expect(worker.sent).toContainEqual({
    type: "communication-response",
    id: 2,
    result: {
      ok: false,
      error: expect.objectContaining({ code: "PLUGIN_PERMISSION_DENIED" }),
    },
  });
}

describe("preview isolation through the real message bridge", () => {
  it("releases an installation Worker still loading when the Host is disposed", async () => {
    const { host } = fixture();
    expect(
      (await host.previewPluginEntry("pending install", "isolated")).ok,
    ).toBe(true);
    state.ready = false;
    const installation = host.installPluginEntry("pending install", "isolated");
    await vi.waitFor(() => expect(state.workers).toHaveLength(2));
    await host.dispose();
    expect((await installation).ok).toBe(false);
    for (const worker of state.workers) expectReleased(worker);
    expect(host.pluginRegistry.list()).toEqual([]);
  });

  it.each([true, false])(
    "rejects top-level requests, releases repeated previews and never resumes after connection (connected=%s)",
    async (connected) => {
      const { host, logs } = fixture();
      try {
        if (connected)
          expect((await host.connect(createDefaultRtuProfile(), null)).ok).toBe(
            true,
          );
        for (let attempt = 0; attempt < 3; attempt++) {
          const controller = new AbortController();
          expect(
            (
              await host.previewPluginEntry(
                "attack",
                "isolated",
                controller.signal,
              )
            ).ok,
          ).toBe(true);
          controller.abort();
          expect((await host.installPluginEntry("attack", "isolated")).ok).toBe(
            false,
          );
          for (const worker of state.workers) expectReleased(worker);
        }
        if (!connected)
          expect((await host.connect(createDefaultRtuProfile(), null)).ok).toBe(
            true,
          );
        for (const worker of state.workers) {
          request(worker, "read", 3);
          request(worker, "write", 4);
        }
        expect(logs).toEqual([]);
        expect(host.pluginRegistry.list()).toEqual([]);
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
      } finally {
        await host.dispose();
      }
    },
  );

  it.each(["cancel", "host", "timeout"] as const)(
    "releases a worker with no ready reply on %s",
    async (action) => {
      vi.useFakeTimers();
      const { host } = fixture();
      try {
        state.ready = false;
        const controller = new AbortController();
        const pending = host.previewPluginEntry(
          "never ready",
          "isolated",
          controller.signal,
        );
        if (action === "cancel") controller.abort();
        if (action === "host") await host.dispose();
        if (action === "timeout") await vi.advanceTimersByTimeAsync(10000);
        expect((await pending).ok).toBe(false);
        for (const worker of state.workers) expectReleased(worker);
        expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        await host.dispose();
        vi.useRealTimers();
      }
    },
  );

  it("reloads confirmed source and permits reads only from the newly bound runtime", async () => {
    const { host, logs } = fixture();
    try {
      expect((await host.connect(createDefaultRtuProfile(), null)).ok).toBe(
        true,
      );
      expect((await host.previewPluginEntry("source", "isolated")).ok).toBe(
        true,
      );
      expect((await host.installPluginEntry("source", "isolated")).ok).toBe(
        true,
      );
      expect(state.workers).toHaveLength(2);
      const [preview, installed] = state.workers;
      if (preview === undefined || installed === undefined)
        throw new Error("Missing runtime");
      expectReleased(preview);
      expect(installed.terminated).toBe(false);
      expect(installed.sent).toContainEqual({
        type: "activate",
        pluginId: manifest.id,
      });
      request(installed, "read", 5);
      await vi.waitFor(() =>
        expect(installed.sent).toContainEqual({
          type: "communication-response",
          id: 5,
          result: { ok: true, value: expect.any(Array) },
        }),
      );
      expect(
        logs.filter((event) => event.direction === "request"),
      ).toHaveLength(1);
      expect(
        host.pluginRegistry.snapshot().plugins[0]?.approval?.permissions,
      ).toEqual(["communication", "device-write"]);
    } finally {
      await host.dispose();
    }
  });
});
