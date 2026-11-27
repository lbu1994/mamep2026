import { createHash } from "node:crypto";
/**
 * HostPluginRuntime 单测。
 *
 * 覆盖：只加载「已启用 + same-process + 可执行」插件、同步能力（addressTransform / codec）
 * 真正注册到宿主注册表、幂等、卸载 / 禁用后无残留、entrySource 变化重建、加载与激活错误隔离。
 * entrySource 为真实单文件 JS（`data:text/javascript;base64` 同进程 import，与生产同路径）。
 */
import { describe, expect, it, vi } from "vitest";
import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";
import {
  createCodecRegistry,
  registerBasicTablesCodecs,
} from "@mamep2026/communication";
import {
  createEmptyPluginStoreData,
  pluginApprovalContent,
  type PluginExecutionMode,
  type PluginStoreData,
  type PluginStorePort,
  type StoredPlugin,
  type HostPluginSnapshot,
  PLUGIN_RUNTIME_LIMITS,
} from "@mamep2026/plugin-api";

import {
  createHostPluginRuntime,
  type HostPluginIssue,
} from "./host-plugin-runtime";

/** 内存插件存储（宿主 load/save 契约）。 */
class MemoryPluginStore implements PluginStorePort {
  private data: PluginStoreData;

  constructor(data: PluginStoreData = createEmptyPluginStoreData()) {
    this.data = data;
  }

  setPlugins(plugins: StoredPlugin[]): void {
    this.data = { schemaVersion: 6, plugins };
  }

  async load(): Promise<Result<PluginStoreData>> {
    return ok(this.data);
  }

  async save(data: PluginStoreData): Promise<Result<void>> {
    this.data = data;
    return ok(undefined);
  }
}

/** 单文件 JS 插件 entry（注册同步能力；记录激活次数）。 */
function entrySource(opts: {
  pluginId: string;
  transformId?: string;
  protocolId?: string;
  failOnActivate?: boolean;
  apiVersion?: string;
}): string {
  const fail =
    opts.failOnActivate === true ? `throw new Error("activate boom");` : "";
  const transform =
    opts.transformId === undefined
      ? ""
      : `
  const registered = ctx.registries.addressTransform.register({
    id: ${JSON.stringify(opts.transformId)},
    protocol: "rtu",
    apply: (address) => ({ ok: true, value: address - 1 }),
  });
  if (!registered.ok) throw new Error(registered.error.code);
`;
  const codec =
    opts.protocolId === undefined
      ? ""
      : `
  ctx.registries.codec.register({
    protocolId: ${JSON.stringify(opts.protocolId)},
    encodeRead: () => new Uint8Array([1]),
    encodeWrite: () => new Uint8Array([2]),
    decodeResponse: () => ({ ok: true, value: { kind: "write" } }),
    parserFactory: () => ({ push: () => ({ done: false }) }),
    expectedLength: () => ({ normal: 5, exception: 5 }),
  });
`;
  return `
export const manifest = {
  id: ${JSON.stringify(opts.pluginId)},
  name: ${JSON.stringify(opts.pluginId)},
  version: "1.0.0",
  apiVersion: ${JSON.stringify(opts.apiVersion ?? "2.0")},
  executionRequirements: { version: 1, requiredExecution: "same-process" },
  description: "host plugin test",
  platform: { web: true, node: true },
  permissions: [],
  contributes: {},
};
export function activate(ctx) {
  const log = globalThis.__hostActivations || (globalThis.__hostActivations = []);
  log.push(${JSON.stringify(opts.pluginId)});
  ${fail}${transform}${codec}
}
`;
}

function storedPlugin(opts: {
  pluginId: string;
  enabled?: boolean;
  executionMode?: PluginExecutionMode;
  source?: string;
  manifest?: unknown;
  apiVersion?: string;
}): StoredPlugin {
  const record: StoredPlugin = {
    manifest: {
      id: opts.pluginId,
      name: opts.pluginId,
      version: "1.0.0",
      apiVersion: opts.apiVersion ?? "2.0",
      executionRequirements: { version: 1, requiredExecution: "same-process" },
      description: "host plugin test",
      platform: { web: true, node: true },
      requiredCapabilities: [],
      permissions: [],
      contributes: {},
    } as StoredPlugin["manifest"],
    enabled: opts.enabled ?? true,
    entrySource:
      opts.source ??
      entrySource({
        pluginId: opts.pluginId,
        transformId: `${opts.pluginId}.t`,
      }),
    ...(opts.executionMode !== undefined
      ? { executionMode: opts.executionMode }
      : { executionMode: "same-process" as const }),
  };
  record.approval = {
    version: 1,
    contentDigest: createHash("sha256")
      .update(
        pluginApprovalContent(
          record.manifest,
          record.entrySource,
          record.executionMode,
        ),
      )
      .digest("hex"),
    permissions: [...record.manifest.permissions],
  };
  return record;
}

function activations(): string[] {
  const scope = globalThis as unknown as { __hostActivations?: string[] };
  scope.__hostActivations = [];
  return scope.__hostActivations;
}

describe("host execution snapshots", () => {
  it("does not report core or another plugin's codec as an effective contribution", async () => {
    const codecs = createCodecRegistry();
    registerBasicTablesCodecs(codecs);
    const coreIds = codecs.list();
    expect(coreIds.length).toBeGreaterThan(0);
    const store = new MemoryPluginStore();
    store.setPlugins([
      storedPlugin({
        pluginId: "codec-owner",
        source: entrySource({
          pluginId: "codec-owner",
          protocolId: "owned-codec",
        }),
      }),
      storedPlugin({
        pluginId: "codec-conflict",
        source: entrySource({
          pluginId: "codec-conflict",
          protocolId: "owned-codec",
        }),
      }),
    ]);
    const runtime = createHostPluginRuntime({ store, codecRegistry: codecs });
    try {
      await runtime.sync();
      expect(
        runtime.getSnapshot().plugins[0]?.contributions.protocolIds,
      ).toEqual(["owned-codec"]);
      expect(
        runtime.getSnapshot().plugins[1]?.contributions.protocolIds,
      ).toEqual([]);
      for (const id of coreIds) expect(codecs.get(id)).toBeDefined();
      expect(codecs.get("owned-codec")).toBeDefined();
    } finally {
      runtime.dispose();
    }
  });
  it("re-evaluates a failed module when the user retries after recovery", async () => {
    vi.stubGlobal("__hostImportRecovered", false);
    const source =
      "if (!globalThis.__hostImportRecovered) throw new Error('host import unavailable');\n" +
      entrySource({ pluginId: "retry-import" });
    const store = new MemoryPluginStore();
    store.setPlugins([storedPlugin({ pluginId: "retry-import", source })]);
    const runtime = createHostPluginRuntime({ store });
    try {
      await runtime.sync();
      expect(runtime.getSnapshot().plugins[0]?.stage).toBe("failed");
      expect(runtime.getSnapshot().plugins[0]?.errors[0]?.code).toBe(
        "PLUGIN_LOAD_FAILED",
      );
      vi.stubGlobal("__hostImportRecovered", true);
      await runtime.reload("retry-import");
      expect(runtime.getSnapshot().plugins[0]?.stage).toBe("active");
    } finally {
      runtime.dispose();
      vi.unstubAllGlobals();
    }
  });
  it("waits for activation and publishes only registered contributions", async () => {
    let release = () => {};
    vi.stubGlobal(
      "__hostStateGate",
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const source = entrySource({
      pluginId: "delayed-state",
      protocolId: "delayed-codec",
      transformId: "delayed-transform",
    }).replace(
      "export function activate(ctx) {",
      "export async function activate(ctx) { await globalThis.__hostStateGate;",
    );
    const store = new MemoryPluginStore();
    store.setPlugins([storedPlugin({ pluginId: "delayed-state", source })]);
    const snapshots: HostPluginSnapshot[] = [];
    const runtime = createHostPluginRuntime({
      store,
      onState: (snapshot) => snapshots.push(snapshot),
    });
    try {
      let done = false;
      const syncing = runtime.sync().then(() => {
        done = true;
      });
      await vi.waitFor(() =>
        expect(runtime.getSnapshot().plugins[0]?.stage).toBe("activating"),
      );
      expect(done).toBe(false);
      expect(
        runtime.getSnapshot().plugins[0]?.contributions.protocolIds,
      ).toEqual([]);
      release();
      await syncing;
      expect(runtime.getSnapshot().plugins[0]).toMatchObject({
        stage: "active",
        contributions: {
          protocolIds: ["delayed-codec"],
          addressTransformIds: ["delayed-transform"],
        },
      });
      expect(
        snapshots.every(
          (snapshot, index) =>
            index === 0 ||
            snapshot.revision > (snapshots[index - 1]?.revision ?? 0),
        ),
      ).toBe(true);
      const detached = runtime.getSnapshot();
      detached.plugins.length = 0;
      expect(runtime.getSnapshot().plugins).toHaveLength(1);
    } finally {
      release();
      runtime.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("removes partial contributions after failure and retries only the failed plugin", async () => {
    const log = activations();
    vi.stubGlobal("__hostStateFail", true);
    const source = entrySource({
      pluginId: "retry-state",
      protocolId: "retry-codec",
      transformId: "retry-transform",
    }).replace(
      "\n}\n",
      "\nif (globalThis.__hostStateFail) throw new Error('host activation rejected');\n}\n",
    );
    const store = new MemoryPluginStore();
    store.setPlugins([
      storedPlugin({ pluginId: "retry-state", source }),
      storedPlugin({ pluginId: "healthy-state" }),
    ]);
    const runtime = createHostPluginRuntime({ store });
    try {
      await runtime.sync();
      const failed = runtime
        .getSnapshot()
        .plugins.find((plugin) => plugin.pluginId === "retry-state");
      expect(failed).toMatchObject({
        stage: "failed",
        contributions: { protocolIds: [], addressTransformIds: [] },
        errors: [
          {
            code: "PLUGIN_HOOK_FAILED",
            technicalMessage: "host activation rejected",
          },
        ],
      });
      expect(runtime.getCodecRegistry().get("retry-codec")).toBeUndefined();
      expect(runtime.resolveAddressTransform("retry-transform")).toBeNull();
      expect(runtime.resolveAddressTransform("healthy-state.t")).not.toBeNull();
      vi.stubGlobal("__hostStateFail", false);
      await runtime.reload("retry-state");
      const recovered = runtime
        .getSnapshot()
        .plugins.find((plugin) => plugin.pluginId === "retry-state");
      expect(recovered?.stage).toBe("active");
      expect(recovered?.errors).toEqual([]);
      expect(recovered?.generation).toBeGreaterThan(failed?.generation ?? 0);
      expect(log.filter((id) => id === "healthy-state")).toHaveLength(1);
      expect(runtime.resolveAddressTransform("retry-transform")).not.toBeNull();
    } finally {
      runtime.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("reports activation timeout and ignores completion after disposal", async () => {
    vi.useFakeTimers();
    let release = () => {};
    vi.stubGlobal(
      "__hostTimeoutGate",
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const source = entrySource({
      pluginId: "timeout-state",
      protocolId: "timeout-codec",
    }).replace(
      "export function activate(ctx) {",
      "export async function activate(ctx) { await globalThis.__hostTimeoutGate;",
    );
    const store = new MemoryPluginStore();
    store.setPlugins([storedPlugin({ pluginId: "timeout-state", source })]);
    const onState = vi.fn();
    const runtime = createHostPluginRuntime({ store, onState });
    try {
      const syncing = runtime.sync();
      await vi.waitFor(() =>
        expect(runtime.getSnapshot().plugins[0]?.stage).toBe("activating"),
      );
      await vi.advanceTimersByTimeAsync(
        PLUGIN_RUNTIME_LIMITS.activateTimeoutMs,
      );
      await syncing;
      expect(runtime.getSnapshot().plugins[0]).toMatchObject({
        stage: "failed",
        errors: [
          {
            code: "PLUGIN_HOOK_FAILED",
            technicalMessage: "plugin activation timed out",
          },
        ],
      });
      runtime.dispose();
      const published = onState.mock.calls.length;
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(onState).toHaveBeenCalledTimes(published);
      expect(runtime.getCodecRegistry().get("timeout-codec")).toBeUndefined();
    } finally {
      release();
      runtime.dispose();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

it("rejects same-process source whose approved manifest requires isolation before import", async () => {
  const record = storedPlugin({ pluginId: "declared-isolated" });
  record.manifest.executionRequirements = {
    version: 1,
    requiredExecution: "isolated",
  };
  record.entrySource = "globalThis.__unexpectedExecution = true;";
  record.approval = {
    version: 1,
    contentDigest: createHash("sha256")
      .update(
        pluginApprovalContent(
          record.manifest,
          record.entrySource,
          record.executionMode,
        ),
      )
      .digest("hex"),
    permissions: [],
  };
  const store = new MemoryPluginStore();
  store.setPlugins([record]);
  const onIssue = vi.fn();
  const runtime = createHostPluginRuntime({ store, onIssue });
  await runtime.sync();
  expect(runtime.listLoadedPluginIds()).toEqual([]);
  expect(onIssue).toHaveBeenCalledWith(
    expect.objectContaining({ code: "PLUGIN_PERMISSION_DENIED" }),
  );
  expect(Reflect.get(globalThis, "__unexpectedExecution")).toBeUndefined();
  runtime.dispose();
});

describe("HostPluginRuntime（ADR-055）", () => {
  it.each(["source", "mode", "manifest", "missing"] as const)(
    "rejects %s tampering in persisted host consent on restart",
    async (change) => {
      const log = activations();
      const store = new MemoryPluginStore();
      const record = storedPlugin({ pluginId: "approved" });
      store.setPlugins([record]);
      const first = createHostPluginRuntime({ store });
      await first.sync();
      expect(first.listLoadedPluginIds()).toEqual(["approved"]);
      first.dispose();
      log.length = 0;

      const tampered = { ...record };
      if (change === "source")
        tampered.entrySource +=
          '\nthrow new Error("Unapproved source executed");';
      if (change === "mode") {
        // An isolated approval must never authorize execution in the Node host.
        tampered.approval = storedPlugin({
          pluginId: "approved",
          executionMode: "isolated",
        }).approval;
      }
      if (change === "manifest")
        tampered.manifest = { ...record.manifest, version: "2.0.0" };
      if (change === "missing") delete tampered.approval;
      store.setPlugins([tampered]);
      const issues: HostPluginIssue[] = [];
      const restarted = createHostPluginRuntime({
        store,
        onIssue: (issue) => issues.push(issue),
      });
      try {
        await restarted.sync();
        expect(restarted.listLoadedPluginIds()).toEqual([]);
        expect(log).toEqual([]);
        expect(issues).toEqual([
          expect.objectContaining({
            pluginId: "approved",
            code: "PLUGIN_PERMISSION_DENIED",
          }),
        ]);
      } finally {
        restarted.dispose();
      }
    },
  );

  it("首次 sync：只加载「已启用 + same-process + 有 entrySource」插件，并把同步能力注册到宿主注册表", async () => {
    const log = activations();
    const store = new MemoryPluginStore();
    store.setPlugins([
      storedPlugin({
        pluginId: "alpha",
        source: entrySource({
          pluginId: "alpha",
          transformId: "alpha.transform",
          protocolId: "alpha-protocol",
        }),
      }),
      // 隔离线程执行：宿主不加载（无法贡献同步能力）
      storedPlugin({ pluginId: "beta", executionMode: "isolated" }),
      // 纯清单插件（有 executionMode 但无 entrySource）：无执行面
      {
        manifest: {
          id: "gamma",
          name: "gamma",
          version: "1.0.0",
          apiVersion: "2.0",
          description: "manifest only",
          platform: { web: true, node: true },
          requiredCapabilities: [],
          permissions: [],
          contributes: {},
        },
        enabled: true,
        executionMode: "same-process",
      },
      // 已禁用：宿主不加载（避免禁用插件在宿主侧残留同步能力）
      storedPlugin({ pluginId: "delta", enabled: false }),
    ]);

    const runtime = createHostPluginRuntime({ store });
    await runtime.sync();

    expect(runtime.listLoadedPluginIds()).toEqual(["alpha"]);
    expect(log).toEqual(["alpha"]);

    const transform = runtime.resolveAddressTransform("alpha.transform");
    expect(transform).not.toBeNull();
    const applied = transform?.apply(1000);
    expect(applied?.ok && applied.value).toBe(999);
    expect(runtime.resolveAddressTransform("beta.t")).toBeNull();
    expect(runtime.getCodecRegistry().list()).toContain("alpha-protocol");
  });

  it("未变化时重复 sync 幂等（不重复激活）", async () => {
    const log = activations();
    const store = new MemoryPluginStore();
    store.setPlugins([storedPlugin({ pluginId: "alpha" })]);
    const runtime = createHostPluginRuntime({ store });

    await runtime.sync();
    await runtime.sync();

    expect(log).toEqual(["alpha"]);
    expect(runtime.listLoadedPluginIds()).toEqual(["alpha"]);
  });

  it("注入的 codecRegistry 为同一引用（宿主会话持有的稳定注册表）", async () => {
    const store = new MemoryPluginStore();
    const codecRegistry = createCodecRegistry();
    const runtime = createHostPluginRuntime({ store, codecRegistry });
    expect(runtime.getCodecRegistry()).toBe(codecRegistry);

    store.setPlugins([
      storedPlugin({
        pluginId: "alpha",
        source: entrySource({
          pluginId: "alpha",
          protocolId: "alpha-protocol",
        }),
      }),
    ]);
    await runtime.sync();
    expect(codecRegistry.list()).toContain("alpha-protocol");
  });

  it("禁用 → sync 后卸载并回收同步能力（变换不再可解析）", async () => {
    activations();
    const store = new MemoryPluginStore();
    store.setPlugins([storedPlugin({ pluginId: "alpha" })]);
    const runtime = createHostPluginRuntime({ store });
    await runtime.sync();
    expect(runtime.resolveAddressTransform("alpha.t")).not.toBeNull();

    store.setPlugins([storedPlugin({ pluginId: "alpha", enabled: false })]);
    await runtime.sync();

    expect(runtime.listLoadedPluginIds()).toEqual([]);
    expect(runtime.resolveAddressTransform("alpha.t")).toBeNull();
  });

  it("卸载（存储中移除）→ sync 后宿主不再加载", async () => {
    activations();
    const store = new MemoryPluginStore();
    store.setPlugins([storedPlugin({ pluginId: "alpha" })]);
    const runtime = createHostPluginRuntime({ store });
    await runtime.sync();

    store.setPlugins([]);
    await runtime.sync();

    expect(runtime.listLoadedPluginIds()).toEqual([]);
    expect(runtime.resolveAddressTransform("alpha.t")).toBeNull();
  });

  it("entrySource 变化 → 重建：新变换生效、旧变换消失", async () => {
    const log = activations();
    const store = new MemoryPluginStore();
    store.setPlugins([storedPlugin({ pluginId: "alpha" })]);
    const runtime = createHostPluginRuntime({ store });
    await runtime.sync();
    expect(runtime.resolveAddressTransform("alpha.t")).not.toBeNull();

    store.setPlugins([
      storedPlugin({
        pluginId: "alpha",
        source: entrySource({ pluginId: "alpha", transformId: "alpha.t.v2" }),
      }),
    ]);
    await runtime.sync();

    expect(runtime.resolveAddressTransform("alpha.t")).toBeNull();
    expect(runtime.resolveAddressTransform("alpha.t.v2")).not.toBeNull();
    expect(log).toEqual(["alpha", "alpha"]);
  });

  it("加载失败隔离：坏 entry 不影响其它插件，并上报 PLUGIN_LOAD_FAILED", async () => {
    activations();
    const store = new MemoryPluginStore();
    const issues: HostPluginIssue[] = [];
    store.setPlugins([
      storedPlugin({
        pluginId: "broken",
        source: "export const manifest = {;",
      }),
      storedPlugin({ pluginId: "alpha" }),
    ]);
    const runtime = createHostPluginRuntime({
      store,
      onIssue: (issue) => issues.push(issue),
    });

    await runtime.sync();

    expect(runtime.listLoadedPluginIds()).toEqual(["alpha"]);
    expect(runtime.resolveAddressTransform("alpha.t")).not.toBeNull();
    expect(issues).toContainEqual(
      expect.objectContaining({
        pluginId: "broken",
        code: "PLUGIN_LOAD_FAILED",
      }),
    );
  });

  it("activate 抛错隔离：上报 PLUGIN_HOOK_FAILED，其它插件仍可用", async () => {
    activations();
    const store = new MemoryPluginStore();
    const issues: HostPluginIssue[] = [];
    store.setPlugins([
      storedPlugin({
        pluginId: "alpha",
        source: entrySource({ pluginId: "alpha", failOnActivate: true }),
      }),
      storedPlugin({ pluginId: "beta" }),
    ]);
    const runtime = createHostPluginRuntime({
      store,
      onIssue: (issue) => issues.push(issue),
    });

    await runtime.sync();

    expect(issues).toContainEqual(
      expect.objectContaining({
        pluginId: "alpha",
        code: "PLUGIN_HOOK_FAILED",
      }),
    );
    expect(runtime.resolveAddressTransform("beta.t")).not.toBeNull();
  });

  it("store 记录清单不合法 → 上报 PLUGIN_MANIFEST_INVALID 且不加载", async () => {
    activations();
    const store = new MemoryPluginStore();
    const issues: HostPluginIssue[] = [];
    store.setPlugins([
      {
        manifest: {
          id: "broken-manifest",
        } as unknown as StoredPlugin["manifest"],
        enabled: true,
        entrySource: entrySource({ pluginId: "broken-manifest" }),
        executionMode: "same-process",
      },
    ]);
    const runtime = createHostPluginRuntime({
      store,
      onIssue: (issue) => issues.push(issue),
    });

    await runtime.sync();

    expect(runtime.listLoadedPluginIds()).toEqual([]);
    expect(issues).toContainEqual(
      expect.objectContaining({
        pluginId: "broken-manifest",
        code: "PLUGIN_MANIFEST_INVALID",
      }),
    );
  });

  it("entry 清单 apiVersion 不兼容 → 上报 PLUGIN_VERSION_INCOMPATIBLE 且不加载", async () => {
    activations();
    const store = new MemoryPluginStore();
    const issues: HostPluginIssue[] = [];
    store.setPlugins([
      storedPlugin({
        pluginId: "alpha",
        source: entrySource({ pluginId: "alpha", apiVersion: "9.0" }),
        apiVersion: "9.0",
      }),
    ]);
    const runtime = createHostPluginRuntime({
      store,
      onIssue: (issue) => issues.push(issue),
    });

    await runtime.sync();

    expect(runtime.listLoadedPluginIds()).toEqual([]);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "PLUGIN_VERSION_INCOMPATIBLE" }),
    );
  });

  it("存储 load 失败 → 上报错误且不抛出", async () => {
    const issue = vi.fn();
    const store: PluginStorePort = {
      load: () =>
        Promise.resolve(
          fail(
            createMamepError({
              code: "PLUGIN_STORE_LOAD_FAILED",
              category: "persistence",
              userMessageKey: "errors.pluginStoreLoadFailed",
              technicalMessage: "boom",
            }),
          ),
        ),
      save: () => Promise.resolve(ok(undefined)),
    };
    const runtime = createHostPluginRuntime({ store, onIssue: issue });

    await runtime.sync();

    expect(issue).toHaveBeenCalledWith(
      expect.objectContaining({ code: "PLUGIN_STORE_LOAD_FAILED" }),
    );
  });

  it("dispose：注销全部并清空注册表", async () => {
    activations();
    const store = new MemoryPluginStore();
    store.setPlugins([storedPlugin({ pluginId: "alpha" })]);
    const runtime = createHostPluginRuntime({ store });
    await runtime.sync();

    runtime.dispose();

    expect(runtime.listLoadedPluginIds()).toEqual([]);
    expect(runtime.resolveAddressTransform("alpha.t")).toBeNull();
  });

  it("does not load plugins from a store response delivered after disposal", async () => {
    let complete: (result: Result<PluginStoreData>) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<Result<PluginStoreData>>((resolve) => {
          complete = resolve;
        }),
    );
    const runtime = createHostPluginRuntime({
      store: { load, save: async () => ok(undefined) },
    });
    const syncing = runtime.sync();
    runtime.dispose();
    complete(
      ok({ schemaVersion: 6, plugins: [storedPlugin({ pluginId: "late" })] }),
    );
    await syncing;
    await runtime.sync();
    expect(runtime.listLoadedPluginIds()).toEqual([]);
    expect(load).toHaveBeenCalledOnce();
  });
});

describe("host codec generations", () => {
  it.each(["disable", "uninstall", "dispose", "source"] as const)(
    "revokes old codec leases on %s",
    async (change) => {
      const store = new MemoryPluginStore();
      const codecs = createCodecRegistry();
      registerBasicTablesCodecs(codecs);
      const coreIds = codecs.list();
      const record = storedPlugin({
        pluginId: "vendor",
        source: entrySource({ pluginId: "vendor", protocolId: "vendor-codec" }),
      });
      store.setPlugins([record]);
      const runtime = createHostPluginRuntime({ store, codecRegistry: codecs });
      await runtime.sync();
      const lease = codecs.capture("vendor-codec");
      expect(lease?.isCurrent()).toBe(true);
      if (change === "dispose") runtime.dispose();
      else {
        store.setPlugins(
          change === "uninstall"
            ? []
            : [
                change === "disable"
                  ? { ...record, enabled: false }
                  : storedPlugin({
                      pluginId: "vendor",
                      source: record.entrySource + "\n// Updated source",
                    }),
              ],
        );
        await runtime.sync();
      }
      expect(lease?.isCurrent()).toBe(false);
      expect(codecs.list()).toEqual(
        change === "source" ? [...coreIds, "vendor-codec"] : coreIds,
      );
      if (change !== "dispose") {
        store.setPlugins([record]);
        await runtime.sync();
        expect(codecs.get("vendor-codec")).toBeDefined();
        expect(lease?.isCurrent()).toBe(false);
      }
      runtime.dispose();
      expect(codecs.list()).toEqual(coreIds);
    },
  );

  it("coalesces a second sync while a stale store load is pending", async () => {
    const store = new MemoryPluginStore();
    const record = storedPlugin({
      pluginId: "vendor",
      source: entrySource({ pluginId: "vendor", protocolId: "vendor-codec" }),
    });
    store.setPlugins([record]);
    const runtime = createHostPluginRuntime({ store });
    await runtime.sync();
    const lease = runtime.getCodecRegistry().capture("vendor-codec");
    const snapshot = await store.load();
    let release: (value: Result<PluginStoreData>) => void = () => {};
    const pending = new Promise<Result<PluginStoreData>>((resolve) => {
      release = resolve;
    });
    const load = vi.spyOn(store, "load").mockReturnValueOnce(pending);
    const first = runtime.sync();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    store.setPlugins([]);
    const second = runtime.sync();
    release(snapshot);
    await Promise.all([first, second]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(lease?.isCurrent()).toBe(false);
    expect(runtime.getCodecRegistry().get("vendor-codec")).toBeUndefined();
    runtime.dispose();
  });
});
