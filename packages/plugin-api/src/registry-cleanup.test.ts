import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@mamep2026/domain";
import { PluginRegistry } from "./registry";
import { PLUGIN_RUNTIME_LIMITS as limits } from "./runtime-limits";
import { pluginManifestSchema } from "./manifest";
import type { PluginContext } from "./lifecycle";

const manifest = pluginManifestSchema.parse({
  id: "cleanup",
  name: "Cleanup",
  description: "Cleanup regression",
  version: "1.0.0",
  apiVersion: "2.0",
  platform: { web: true, node: false },
  permissions: ["communication"],
  contributes: {},
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("registry cleanup deadlines", () => {
  it("does not retain a loaded Worker registered as disabled", async () => {
    const registry = new PluginRegistry();
    const activate = vi.fn(async () => {});
    const dispose = vi.fn(async () => {});
    registry.register(manifest, {
      source: "installed",
      enabled: false,
      remoteRuntime: { load: async () => ok(manifest), activate, dispose },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(activate).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    await registry.dispose();
  });
  it.each(["disable", "uninstall", "host"])(
    "revokes before a hung deactivate and always disposes on %s",
    async (action) => {
      let context: PluginContext | undefined;
      const read = vi.fn(async () => ok([1]));
      const registry = new PluginRegistry({
        communicationApi: {
          readRegisters: read,
          writeRegisters: async () => ok(undefined),
        },
      });
      const dispose = vi.fn(async () => {});
      let stoppedRead: Promise<unknown> | undefined;
      registry.register(manifest, {
        source: "installed",
        approvedPermissions: ["communication"],
        remoteRuntime: {
          load: async () => ok(manifest),
          activate: async (ctx) => {
            context = ctx;
          },
          deactivate: () => {
            stoppedRead = context?.communication.readRegisters({
              address: 0,
              quantity: 1,
            });
            return new Promise(() => {});
          },
          dispose,
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      let host: Promise<void> | undefined;
      if (action === "disable") registry.setEnabled(manifest.id, false);
      if (action === "uninstall") registry.unregister(manifest.id);
      if (action === "host") host = registry.dispose();
      expect(await stoppedRead).toMatchObject({
        ok: false,
        error: { code: "PLUGIN_PERMISSION_DENIED" },
      });
      expect(read).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(limits.deactivateTimeoutMs);
      await host;
      expect(dispose).toHaveBeenCalledOnce();
      expect(registry.isEnabled(manifest.id)).toBe(false);
      await registry.dispose();
    },
  );

  it.each(["same-process", "isolated"])(
    "observes a rejected %s deactivate and still releases resources",
    async (mode) => {
      const registry = new PluginRegistry();
      const dispose = vi.fn(async () => {});
      const runtime = {
        load: async () => ok(manifest),
        activate: async () => {},
        deactivate: async () => {
          throw new Error("stop failure");
        },
        dispose,
      };
      registry.register(manifest, {
        source: "installed",
        ...(mode === "isolated" ? { remoteRuntime: runtime } : { runtime }),
      });
      await vi.advanceTimersByTimeAsync(0);
      registry.unregister(manifest.id);
      await vi.advanceTimersByTimeAsync(0);
      expect(dispose).toHaveBeenCalledOnce();
      expect(registry.getLoadErrors()).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining("stop failure"),
        }),
      );
    },
  );

  it("bounds an asynchronous same-process activation and persists disabled metadata", async () => {
    const registry = new PluginRegistry();
    registry.register(manifest, {
      source: "installed",
      runtime: { activate: () => new Promise(() => {}) },
    });
    await vi.advanceTimersByTimeAsync(limits.activateTimeoutMs);
    expect(registry.getLifecycleState(manifest.id)).toBe("failed");
    expect(registry.snapshot().plugins[0]?.enabled).toBe(false);
    await registry.dispose();
  });

  it("rejects new registration after Host disposal", async () => {
    const registry = new PluginRegistry();
    await registry.dispose();
    const activate = vi.fn();
    expect(registry.register(manifest, { runtime: { activate } }).ok).toBe(
      false,
    );
    expect(activate).not.toHaveBeenCalled();
  });

  it("waits for an earlier uninstall cleanup when the Host is released", async () => {
    const registry = new PluginRegistry();
    const dispose = vi.fn(async () => {});
    registry.register(manifest, {
      source: "installed",
      remoteRuntime: {
        load: async () => ok(manifest),
        activate: async () => {},
        deactivate: () => new Promise(() => {}),
        dispose,
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    registry.unregister(manifest.id);
    let closed = false;
    const shutdown = registry.dispose().then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(limits.deactivateTimeoutMs);
    await shutdown;
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("does not dispose a new same-process activation when an earlier stop completes", async () => {
    const registry = new PluginRegistry();
    const order: string[] = [];
    let complete: () => void = () => {};
    registry.register(manifest, {
      source: "installed",
      runtime: {
        activate: () => {
          order.push("activate");
        },
        deactivate: () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
        dispose: () => {
          order.push("dispose");
        },
      },
    });
    const stop = registry.setEnabled(manifest.id, false);
    const restart = registry.setEnabled(manifest.id, true);
    expect(order).toEqual(["activate"]);
    complete();
    await Promise.all([stop, restart]);
    expect(order).toEqual(["activate", "dispose", "activate"]);
    const shutdown = registry.dispose();
    complete();
    await shutdown;
  });
});
