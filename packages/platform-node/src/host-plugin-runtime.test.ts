/**
 * HostPluginRuntime 单测。
 *
 * 覆盖：只加载「已启用 + same-process + 可执行」插件、同步能力（addressTransform / codec）
 * 真正注册到宿主注册表、幂等、卸载 / 禁用后无残留、entrySource 变化重建、加载与激活错误隔离。
 * entrySource 为真实单文件 JS（`data:text/javascript;base64` 同进程 import，与生产同路径）。
 */
import { describe, expect, it, vi } from "vitest";
import { createMamepError, fail, ok, type Result } from "@mamep2026/domain";
import { createCodecRegistry } from "@mamep2026/communication";
import {
  createEmptyPluginStoreData,
  type PluginExecutionMode,
  type PluginStoreData,
  type PluginStorePort,
  type StoredPlugin,
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
    this.data = { schemaVersion: 4, plugins };
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
}): StoredPlugin {
  return {
    manifest: {
      id: opts.pluginId,
      name: opts.pluginId,
      version: "1.0.0",
      apiVersion: "2.0",
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
}

function activations(): string[] {
  const scope = globalThis as unknown as { __hostActivations?: string[] };
  scope.__hostActivations = [];
  return scope.__hostActivations;
}

describe("HostPluginRuntime（ADR-055）", () => {
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
});
