// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@mamep2026/domain";
import { InMemoryWorkspaceRepository } from "@mamep2026/test-kit";
import {
  createPluginApproval,
  pluginManifestSchema,
  type PluginRemoteRuntime,
  type StoredPlugin,
  type PluginStoreData,
} from "@mamep2026/plugin-api";
import {
  createWebPluginRemoteRuntime,
  createWebPluginPreviewRuntime,
  loadWebPluginEntry,
} from "@mamep2026/platform-web";
import { BrowserAppHost } from "./AppHost";

const { hash } = vi.hoisted(() => {
  const contents = new Map<string, string>();
  return {
    hash: async (content: string) => {
      const existing = contents.get(content);
      if (existing !== undefined) return existing;
      const digest = (contents.size + 1).toString(16).padStart(64, "0");
      contents.set(content, digest);
      return digest;
    },
  };
});

vi.mock("@mamep2026/platform-web", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@mamep2026/platform-web")>();
  return {
    ...original,
    createWebPluginRemoteRuntime: vi.fn(),
    createWebPluginPreviewRuntime: vi.fn(),
    loadWebPluginEntry: vi.fn(),
    hashPluginContent: hash,
  };
});

const manifest = pluginManifestSchema.parse({
  id: "consent",
  name: "Consent",
  description: "Test consent",
  version: "1.0.0",
  apiVersion: "2.0",
  platform: { web: true, node: false },
  permissions: ["communication", "device-write"],
});
const runtimes: PluginRemoteRuntime[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  runtimes.length = 0;
  const createRuntime = () => {
    const runtime: PluginRemoteRuntime = {
      load: vi.fn(async () => ok(manifest)),
      activate: vi.fn(async () => {}),
      deactivate: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
    };
    runtimes.push(runtime);
    return runtime;
  };
  vi.mocked(createWebPluginRemoteRuntime).mockImplementation(createRuntime);
  vi.mocked(createWebPluginPreviewRuntime).mockImplementation(createRuntime);
  vi.mocked(loadWebPluginEntry).mockResolvedValue(
    ok({ manifest, activate: () => {} }),
  );
});

function fixture(plugins: StoredPlugin[] = []) {
  const store = {
    load: vi.fn(async () => ok<PluginStoreData>({ schemaVersion: 5, plugins })),
    save: vi.fn(async (_data: PluginStoreData) => ok(undefined)),
  };
  const host = new BrowserAppHost({
    platform: null,
    repository: new InMemoryWorkspaceRepository(),
    mockTransport: true,
    pluginStore: store,
    yieldToMainThread: async () => {},
  });
  return { host, store };
}

describe("host consent and runtime lifecycle", () => {
  it.each(["cancel", "host", "replace"] as const)(
    "releases a pending preview immediately on %s and rejects its late manifest",
    async (action) => {
      const { host } = fixture();
      const controller = new AbortController();
      let resolveLoad:
        ((value: ReturnType<typeof ok<typeof manifest>>) => void) | undefined;
      const dispose = vi.fn(async () => {});
      vi.mocked(createWebPluginPreviewRuntime).mockReturnValueOnce({
        load: () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          }),
        dispose,
      });
      const pending = host.previewPluginEntry(
        "old",
        "isolated",
        controller.signal,
      );
      if (action === "cancel") controller.abort();
      if (action === "host") await host.dispose();
      if (action === "replace")
        await host.previewPluginEntry("new", "isolated");
      expect(dispose).toHaveBeenCalledOnce();
      resolveLoad?.(ok(manifest));
      expect((await pending).ok).toBe(false);
      expect(dispose).toHaveBeenCalledOnce();
      if (action === "replace") {
        expect((await host.installPluginEntry("new", "isolated")).ok).toBe(
          true,
        );
      } else {
        expect((await host.installPluginEntry("old", "isolated")).ok).toBe(
          false,
        );
      }
      await host.dispose();
    },
  );

  it("revokes a completed preview on cancel and reloads only newly confirmed source", async () => {
    const { host } = fixture();
    const controller = new AbortController();
    await host.previewPluginEntry("source", "isolated", controller.signal);
    controller.abort();
    expect((await host.installPluginEntry("source", "isolated")).ok).toBe(
      false,
    );
    expect(createWebPluginRemoteRuntime).not.toHaveBeenCalled();
    await host.previewPluginEntry("source", "isolated");
    expect((await host.installPluginEntry("source", "isolated")).ok).toBe(true);
    expect(createWebPluginRemoteRuntime).toHaveBeenCalledOnce();
    expect(runtimes[0]?.dispose).toHaveBeenCalledOnce();
    expect(runtimes[1]?.dispose).toHaveBeenCalledOnce();
    await host.dispose();
  });

  it("releases the preview when load throws or manifest validation fails", async () => {
    const { host } = fixture();
    const dispose = vi.fn(async () => {});
    vi.mocked(createWebPluginPreviewRuntime).mockReturnValueOnce({
      load: async () => {
        throw new Error("load failed");
      },
      dispose,
    });
    await expect(host.previewPluginEntry("throws", "isolated")).rejects.toThrow(
      "load failed",
    );
    expect(dispose).toHaveBeenCalledOnce();
    vi.mocked(createWebPluginPreviewRuntime).mockReturnValueOnce({
      load: async () => ok({ ...manifest, id: "" }),
      dispose,
    });
    expect((await host.previewPluginEntry("invalid", "isolated")).ok).toBe(
      false,
    );
    expect(dispose).toHaveBeenCalledTimes(2);
    expect((await host.installPluginEntry("invalid", "isolated")).ok).toBe(
      false,
    );
    await host.dispose();
  });
  it.each(["mode", "manifest", "permissions", "missing"] as const)(
    "rejects %s tampering on restart and explicit enable before executing source",
    async (change) => {
      const record: StoredPlugin = {
        manifest,
        enabled: true,
        entrySource: "approved source",
        executionMode: change === "mode" ? "isolated" : "same-process",
      };
      const approval = await createPluginApproval(record, hash);
      const tampered: StoredPlugin = { ...record, approval };
      if (change === "mode") tampered.executionMode = "same-process";
      if (change === "manifest")
        tampered.manifest = { ...manifest, version: "2.0.0" };
      if (change === "permissions")
        tampered.approval = { ...approval, permissions: [] };
      if (change === "missing") delete tampered.approval;
      const { host } = fixture([tampered]);
      await host.startPlugins();
      expect(host.pluginRegistry.isEnabled(manifest.id)).toBe(false);
      expect((await host.setPluginEnabled(manifest.id, true)).ok).toBe(false);
      expect(loadWebPluginEntry).not.toHaveBeenCalled();
      expect(createWebPluginRemoteRuntime).not.toHaveBeenCalled();
      expect(host.pluginRegistry.getEntrySource(manifest.id)).toBe(
        "approved source",
      );
      await host.dispose();
    },
  );

  it("does not replace a same-source reinstall with an older enable operation", async () => {
    const record: StoredPlugin = {
      manifest,
      enabled: false,
      entrySource: "source",
      executionMode: "same-process",
    };
    const { host } = fixture([
      { ...record, approval: await createPluginApproval(record, hash) },
    ]);
    await host.startPlugins();
    let release:
      | ((value: Awaited<ReturnType<typeof loadWebPluginEntry>>) => void)
      | undefined;
    let entered: (() => void) | undefined;
    const loading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.mocked(loadWebPluginEntry).mockImplementationOnce(() => {
      entered?.();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const enable = host.setPluginEnabled(manifest.id, true);
    await loading;
    host.pluginRegistry.unregister(manifest.id);
    await host.previewPluginEntry("source", "isolated");
    expect((await host.installPluginEntry("source", "isolated")).ok).toBe(true);
    release?.(ok({ manifest, activate: () => {} }));
    expect((await enable).ok).toBe(false);
    expect(host.pluginRegistry.snapshot().plugins[0]?.executionMode).toBe(
      "isolated",
    );
    expect(host.pluginRegistry.isEnabled(manifest.id)).toBe(true);
    await host.dispose();
  });

  it("does not import same-process code when the host closes during approval", async () => {
    const { host } = fixture();
    await host.previewPluginEntry("source", "same-process");
    const install = host.installPluginEntry("source", "same-process");
    await host.dispose();
    expect((await install).ok).toBe(false);
    expect(loadWebPluginEntry).not.toHaveBeenCalled();
    const runtimeCount = runtimes.length;
    expect((await host.previewPluginEntry("source", "isolated")).ok).toBe(
      false,
    );
    expect(runtimes).toHaveLength(runtimeCount);
  });

  it("does not finish an enable operation after the user disables the plugin", async () => {
    const record: StoredPlugin = {
      manifest,
      enabled: false,
      entrySource: "source",
      executionMode: "isolated",
    };
    const { host } = fixture([
      { ...record, approval: await createPluginApproval(record, hash) },
    ]);
    await host.startPlugins();
    let completeLoad:
      ((value: ReturnType<typeof ok<typeof manifest>>) => void) | undefined;
    let entered: (() => void) | undefined;
    const loading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const dispose = vi.fn(async () => {});
    vi.mocked(createWebPluginRemoteRuntime).mockImplementationOnce(() => ({
      load: () => {
        entered?.();
        return new Promise((resolve) => {
          completeLoad = resolve;
        });
      },
      activate: vi.fn(async () => {}),
      dispose,
    }));
    const enable = host.setPluginEnabled(manifest.id, true);
    await loading;
    await host.setPluginEnabled(manifest.id, false);
    completeLoad?.(ok(manifest));
    expect((await enable).ok).toBe(false);
    expect(host.pluginRegistry.isEnabled(manifest.id)).toBe(false);
    expect(host.pluginRegistry.getEntrySource(manifest.id)).toBe("source");
    expect(dispose).toHaveBeenCalledOnce();
    await host.dispose();
  });

  it("disposes preview immediately and requires matching preview before installation", async () => {
    const { host } = fixture();
    expect((await host.installPluginEntry("source", "isolated")).ok).toBe(
      false,
    );
    expect(createWebPluginRemoteRuntime).not.toHaveBeenCalled();
    expect((await host.previewPluginEntry("source", "same-process")).ok).toBe(
      true,
    );
    expect(loadWebPluginEntry).not.toHaveBeenCalled();
    expect(runtimes[0]?.dispose).toHaveBeenCalledOnce();
    expect(runtimes[0]?.activate).not.toHaveBeenCalled();
    expect(
      (await host.installPluginEntry("different source", "isolated")).ok,
    ).toBe(false);
    await host.previewPluginEntry("source", "isolated");
    expect((await host.installPluginEntry("source", "isolated")).ok).toBe(true);
    expect(
      host.pluginRegistry.snapshot().plugins[0]?.approval?.permissions,
    ).toEqual(["communication", "device-write"]);
    await host.dispose();
  });

  it("preserves unapproved or disabled executable records without evaluating source", async () => {
    const record: StoredPlugin = {
      manifest,
      enabled: true,
      entrySource: "source",
      executionMode: "same-process",
    };
    const { host } = fixture([record]);
    await host.startPlugins();
    expect(loadWebPluginEntry).not.toHaveBeenCalled();
    expect(createWebPluginRemoteRuntime).not.toHaveBeenCalled();
    expect(host.pluginRegistry.getEntrySource(manifest.id)).toBe("source");
    expect(host.pluginRegistry.isEnabled(manifest.id)).toBe(false);
    expect((await host.setPluginEnabled(manifest.id, true)).ok).toBe(false);
    await host.dispose();
    const approved = {
      ...record,
      enabled: false,
      approval: await createPluginApproval(record, hash),
    };
    const second = fixture([approved]);
    await second.host.startPlugins();
    expect(loadWebPluginEntry).not.toHaveBeenCalled();
    expect((await second.host.setPluginEnabled(manifest.id, true)).ok).toBe(
      true,
    );
    expect(loadWebPluginEntry).toHaveBeenCalledOnce();
    await second.host.dispose();
  });

  it("rejects a source change before importing approved same-process code", async () => {
    const record: StoredPlugin = {
      manifest,
      enabled: true,
      entrySource: "original",
      executionMode: "same-process",
    };
    const { host } = fixture([
      {
        ...record,
        entrySource: "changed",
        approval: await createPluginApproval(record, hash),
      },
    ]);
    await host.startPlugins();
    expect(loadWebPluginEntry).not.toHaveBeenCalled();
    expect(host.pluginRegistry.isEnabled(manifest.id)).toBe(false);
    await host.dispose();
  });

  it("does not persist runtime teardown as plugin uninstall", async () => {
    const { host, store } = fixture([{ manifest, enabled: true }]);
    await host.startPlugins();
    host.pluginRegistry.setEnabled(manifest.id, false);
    expect(store.save).toHaveBeenCalled();
    const count = store.save.mock.calls.length;
    await host.dispose();
    expect(store.save.mock.calls).toHaveLength(count);
    expect(store.save.mock.calls.at(-1)?.[0].plugins).toHaveLength(1);
  });

  it("does not restore or subscribe after a pending store load outlives the host", async () => {
    const { host, store } = fixture();
    let release:
      ((value: ReturnType<typeof ok<PluginStoreData>>) => void) | undefined;
    store.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const start = host.startPlugins();
    await host.dispose();
    release?.(ok({ schemaVersion: 5, plugins: [{ manifest, enabled: true }] }));
    await start;
    expect(host.pluginRegistry.list()).toEqual([]);
    expect(store.save).not.toHaveBeenCalled();
  });
});
