import { createHash } from "node:crypto";
/**
 * 宿主侧插件执行面。
 *
 * Electron 主进程 / VSCode Extension Host 从**同一份插件存储**（主进程 plugins.json /
 * Extension Host globalState，即渲染端 `plugin-store-save` 的落点）加载插件并执行，
 * 使插件贡献的 **codec / addressTransform** 在宿主侧可用。
 *
 * 关键语义：
 * - **只执行 `executionMode === "same-process"` 且 enabled 的可执行插件**：
 *   隔离线程插件无法向宿主会话贡献同步 codec/transform，故宿主跳过；纯清单插件无执行面，
 *   同样跳过（其贡献点由渲染端消费）；**已禁用插件同样卸载**（不在宿主侧残留同步能力）。
 * - 触发：宿主启动时一次 + 渲染端每次 `plugin-store-save` 后一次。
 * - Compare enabled same-process plugin IDs and approved content digests; rebuild on change.
 *   （先注销全部宿主插件，再以**新建的** dataType / addressTransform 注册表重新加载并激活）。
 *   全量重建是必要的：`DataTypeRegistry` / `AddressTransformRegistry` 没有注销 API，
 *   复用旧注册表会让**已卸载 / 已禁用插件的变换在宿主侧继续生效**（地址被静默 −1），
 *   与渲染端（能力矩阵已移除）不一致。插件数量极少、同步很稀疏，重建成本可忽略。
 * - Codec scopes are revoked before unregister/dispose hooks run. Existing sessions
 *   retain a lease to the old registration and cannot use a replacement generation.
 * - `ctx.registries` 由宿主提供：codec（宿主会话 codec 注册表）、dataType（Node 侧
 *   `createDataTypeResolver()`，纯 TS 可在宿主运行）、addressTransform（宿主注册表）。
 * - 错误隔离：加载 / activate 失败只影响该插件（记录错误），不影响宿主会话与其它插件。
 * - Publish versioned execution results to the renderer after loading and activation.
 *   A failed plugin has no effective host contributions and can be retried separately.
 */
import {
  createDataTypeResolver,
  type DataTypeResolver,
} from "@mamep2026/data-conversion";
import {
  createCodecRegistry,
  type CodecRegistry,
} from "@mamep2026/communication";
import type { AddressTransform } from "@mamep2026/domain";
import {
  PluginRegistry,
  createUnavailableSyncRegistries,
  matchesPluginApproval,
  pluginApprovalContent,
  type PluginApproval,
  createAddressTransformRegistry,
  pluginManifestSchema,
  runtimeFromLocalEntry,
  type AddressTransformRegistry,
  type PluginManifest,
  type PluginStorePort,
  type PluginHostSyncRegistries,
  type HostPluginSnapshot,
  type HostPluginState,
} from "@mamep2026/plugin-api";

import { loadNodePluginEntry } from "./plugin-local-runtime";

/** 宿主侧插件问题上报（加载失败 / 激活失败 / 兼容性与贡献点警告）。 */
export interface HostPluginIssue {
  pluginId: string;
  code: string;
  technicalMessage: string;
}

export interface HostPluginRuntimeDeps {
  /** 插件存储（宿主侧实现：Electron 主进程 plugins.json / VSCode globalState）。 */
  store: PluginStorePort;
  /** 宿主会话 codec 注册表（可选；缺省内部新建；基础表 codec 由装配点自行注册）。 */
  codecRegistry?: CodecRegistry;
  /** 问题上报（宿主日志 / 应用消息）。 */
  onIssue?: (issue: HostPluginIssue) => void;
  onState?: (snapshot: HostPluginSnapshot) => void;
}

/** 安全提取清单 id（清单可能坏到不是对象，上报时不能抛错）。 */
function manifestIdOf(manifest: unknown): string {
  if (typeof manifest === "object" && manifest !== null) {
    const id = (manifest as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return "";
}

/** Compare approved content, including the manifest and execution mode, before rebuilding. */
function setSignature(
  desired: Map<string, { entrySource: string; approval: PluginApproval }>,
): string {
  return [...desired.entries()]
    .map(([id, value]) => `${id}@${value.approval.contentDigest}`)
    .sort()
    .join("|");
}

export class HostPluginRuntime {
  private readonly deps: HostPluginRuntimeDeps;
  private readonly registry: PluginRegistry;
  /** Stable lookup shared with sessions; plugin generations own revocable entries. */
  private readonly codecRegistry: CodecRegistry;
  private readonly syncRegistries: PluginHostSyncRegistries;
  /** 当前 dataType / addressTransform 注册表（集合变化时整体重建）。 */
  private dataTypeResolver: DataTypeResolver;
  private addressTransformRegistry: AddressTransformRegistry;
  /** 已加载插件（id → { entrySource }）与集合签名（均只含已启用 same-process 插件）。 */
  private loaded = new Map<string, { entrySource: string }>();
  private signature: string | null = null;
  private syncPending = false;
  private syncPromise: Promise<void> | null = null;
  private disposed = false;
  private revision = 0;
  private generation = 0;
  private states = new Map<string, HostPluginState>();
  private storeError: HostPluginSnapshot["error"] = null;
  private readonly transforms = new Map<string, AddressTransformRegistry>();
  private readonly retryIds = new Set<string>();

  /** Return a detached snapshot; callers cannot change runtime state. */
  getSnapshot(): HostPluginSnapshot {
    return structuredClone({
      schemaVersion: 1,
      revision: this.revision,
      plugins: [...this.states.values()],
      error: this.storeError,
    });
  }

  private publish(): void {
    if (this.disposed || this.syncPending) return;
    this.revision += 1;
    this.deps.onState?.(this.getSnapshot());
  }

  /** Retry one failed plugin using its current saved approval. */
  async reload(pluginId: string): Promise<void> {
    if (this.states.get(pluginId)?.stage !== "failed" || this.disposed) return;
    this.retryIds.add(pluginId);
    await this.sync();
  }

  constructor(deps: HostPluginRuntimeDeps) {
    this.deps = deps;
    this.codecRegistry = deps.codecRegistry ?? createCodecRegistry();
    this.dataTypeResolver = createDataTypeResolver();
    this.addressTransformRegistry = createAddressTransformRegistry();
    // 委托式同步注册面：dataType / addressTransform 读**当前**注册表（支持重建后替换）。
    this.syncRegistries = {
      codec: createUnavailableSyncRegistries().codec,
      createCodecScope: (pluginId) => this.codecRegistry.createScope(pluginId),
      dataType: {
        register: (id, handlers) =>
          this.dataTypeResolver.register(id, handlers),
        get: (id) => this.dataTypeResolver.get(id),
        list: () => this.dataTypeResolver.list(),
      },
      addressTransform: {
        register: (transform) =>
          this.addressTransformRegistry.register(transform),
        get: (id) => this.addressTransformRegistry.get(id),
        list: () => this.addressTransformRegistry.list(),
      },
    };
    this.registry = new PluginRegistry({ syncRegistries: this.syncRegistries });
  }

  /** 宿主会话用 codec 注册表（含插件注册的 codec）。 */
  getCodecRegistry(): CodecRegistry {
    return this.codecRegistry;
  }

  /**
   * 地址变换解析（宿主会话注入用）：读**当前**注册表，未注册返回 null。
   * 该闭包可长期持有（宿主会话构造时注入一次），重建后自动指向新注册表。
   */
  resolveAddressTransform = (transformId: string): AddressTransform | null => {
    for (const [pluginId, registry] of this.transforms) {
      if (
        this.states.get(pluginId)?.stage === "active" &&
        this.registry.isEnabled(pluginId)
      ) {
        const transform = registry.get(transformId);
        if (transform !== undefined) return transform;
      }
    }
    return null;
  };

  /** 已由宿主加载的插件 id（诊断 / 测试用）。 */
  listLoadedPluginIds(): string[] {
    return [...this.loaded.keys()];
  }

  /**
   * Load enabled, approved same-process plugins on startup and after store saves.
   * Rebuild when IDs or approved content change. Coalesce concurrent saves and
   * resolve all callers after the latest requested store load completes.
   */
  sync(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.syncPending = true;
    if (this.syncPromise !== null) return this.syncPromise;
    // Coalesce saves while loading; reload the latest store before resolving callers.
    this.syncPending = false;
    const initialSync = this.syncOnce();
    this.syncPromise = (async () => {
      try {
        await initialSync;
        while (this.syncPending && !this.disposed) {
          this.syncPending = false;
          await this.syncOnce();
        }
      } finally {
        this.syncPromise = null;
      }
    })();
    return this.syncPromise;
  }

  private async syncOnce(): Promise<void> {
    const stored = await this.deps.store.load();
    if (this.disposed) return;
    if (!stored.ok) {
      this.storeError = {
        code: stored.error.code,
        technicalMessage: stored.error.technicalMessage,
      };
      this.report("", stored.error.code, stored.error.technicalMessage);
      this.publish();
      return;
    }
    this.storeError = null;
    const previousStates = this.states;
    this.states = new Map();
    const desired = new Map<
      string,
      {
        manifest: PluginManifest;
        entrySource: string;
        approval: PluginApproval;
      }
    >();
    for (const entry of stored.value.plugins) {
      const pluginId = manifestIdOf(entry.manifest);
      if (!pluginId) continue;
      const prior = previousStates.get(pluginId);
      const contentDigest = entry.approval?.contentDigest ?? null;
      const state: HostPluginState =
        prior?.contentDigest === contentDigest
          ? structuredClone(prior)
          : {
              pluginId,
              generation: this.generation,
              contentDigest,
              stage: "loading",
              contributions: {
                protocolIds: [],
                dataTypeIds: [],
                addressTransformIds: [],
              },
              errors: [],
            };
      this.states.set(pluginId, state);
      if (
        !entry.enabled ||
        entry.executionMode !== "same-process" ||
        entry.entrySource === undefined
      ) {
        state.stage = !entry.enabled ? "disabled" : "unsupported";
        state.contributions = {
          protocolIds: [],
          dataTypeIds: [],
          addressTransformIds: [],
        };
        state.errors = [];
        continue;
      }
      const parsed = pluginManifestSchema.safeParse(entry.manifest);
      if (!parsed.success) {
        this.report(
          manifestIdOf(entry.manifest),
          "PLUGIN_MANIFEST_INVALID",
          parsed.error.message,
        );
        continue;
      }
      if (
        entry.approval === undefined ||
        !(await matchesPluginApproval(entry, async (content) =>
          createHash("sha256").update(content).digest("hex"),
        ))
      ) {
        this.report(
          entry.manifest.id,
          "PLUGIN_PERMISSION_DENIED",
          "plugin requires renewed installation consent",
        );
        continue;
      }
      if (this.disposed) return;
      desired.set(entry.manifest.id, {
        approval: entry.approval,
        manifest: parsed.data,
        entrySource: entry.entrySource,
      });
    }

    const nextSignature = setSignature(desired);
    if (nextSignature === this.signature) {
      for (const pluginId of this.retryIds) {
        const next = desired.get(pluginId);
        if (next !== undefined) {
          this.registry.unregister(pluginId);
          this.loaded.delete(pluginId);
          this.transforms.delete(pluginId);
          await this.loadPlugin(pluginId, next);
        }
      }
      this.retryIds.clear();
      this.publish();
      return;
    }
    this.retryIds.clear();
    await this.rebuild(desired);
    if (!this.disposed) this.signature = nextSignature;
    this.publish();
  }

  /** 释放全部宿主插件（注销 + 清空注册表）；宿主退出时调用。 */
  dispose(): void {
    this.disposed = true;
    void this.registry.dispose();
    this.loaded.clear();
    this.transforms.clear();
    this.states.clear();
    this.signature = null;
    this.dataTypeResolver = createDataTypeResolver();
    this.addressTransformRegistry = createAddressTransformRegistry();
  }

  /** 全量重建：注销全部 → 新建 dataType / addressTransform 注册表 → 重新加载并激活。 */
  private async rebuild(
    desired: Map<
      string,
      {
        manifest: PluginManifest;
        entrySource: string;
        approval: PluginApproval;
      }
    >,
  ): Promise<void> {
    for (const pluginId of [...this.loaded.keys()]) {
      this.registry.unregister(pluginId);
    }
    this.loaded.clear();
    this.dataTypeResolver = createDataTypeResolver();
    this.addressTransformRegistry = createAddressTransformRegistry();

    this.transforms.clear();
    for (const pluginId of desired.keys()) {
      const state = this.states.get(pluginId);
      if (state !== undefined) {
        state.stage = "loading";
        state.contributions = {
          protocolIds: [],
          dataTypeIds: [],
          addressTransformIds: [],
        };
      }
    }
    this.publish();
    for (const [pluginId, next] of desired) {
      if (this.disposed) return;
      await this.loadPlugin(pluginId, next);
    }
  }

  private async loadPlugin(
    pluginId: string,
    next: {
      manifest: PluginManifest;
      entrySource: string;
      approval: PluginApproval;
    },
  ): Promise<void> {
    const state = this.states.get(pluginId);
    if (state === undefined) return;
    state.generation = ++this.generation;
    state.stage = "loading";
    state.errors = [];
    state.contributions = {
      protocolIds: [],
      dataTypeIds: [],
      addressTransformIds: [],
    };
    this.publish();
    // Every new generation must avoid cached import failures, including re-enable after recovery.
    const entryResult = await loadNodePluginEntry(next.entrySource, {
      fresh: true,
    });
    if (this.disposed) return;
    if (!entryResult.ok) {
      this.report(
        pluginId,
        entryResult.error.code,
        entryResult.error.technicalMessage,
      );
      this.publish();
      return;
    }
    const parsed = pluginManifestSchema.safeParse(entryResult.value.manifest);
    if (
      !parsed.success ||
      pluginApprovalContent(parsed.data, next.entrySource, "same-process") !==
        pluginApprovalContent(next.manifest, next.entrySource, "same-process")
    ) {
      this.report(
        pluginId,
        "PLUGIN_PERMISSION_DENIED",
        "plugin manifest changed during restore",
      );
      this.publish();
      return;
    }
    state.stage = "activating";
    this.publish();
    const dataTypes = createDataTypeResolver();
    const transforms = createAddressTransformRegistry();
    const runtime = runtimeFromLocalEntry(entryResult.value);
    const codecIds = new Set<string>();
    const errorStart = this.registry.getLoadErrors().length;
    const registered = this.registry.register(parsed.data, {
      approval: next.approval,
      approvedPermissions: next.approval.permissions,
      source: "installed",
      runtime: {
        ...runtime,
        activate: async (ctx) => {
          await runtime.activate({
            ...ctx,
            registries: {
              codec: {
                list: () => ctx.registries.codec.list(),
                register: (codec) => {
                  const result = ctx.registries.codec.register(codec);
                  if (result.ok) codecIds.add(codec.protocolId);
                  return result;
                },
              },
              dataType: {
                register: (id, handlers) =>
                  this.dataTypeResolver.get(id) === undefined
                    ? dataTypes.register(id, handlers)
                    : this.dataTypeResolver.register(id, handlers),
                get: (id) => dataTypes.get(id) ?? this.dataTypeResolver.get(id),
                list: () => [
                  ...this.dataTypeResolver.list(),
                  ...dataTypes.list(),
                ],
              },
              addressTransform: {
                register: (transform) =>
                  this.addressTransformRegistry.get(transform.id) === undefined
                    ? transforms.register({ ...transform, pluginId })
                    : this.addressTransformRegistry.register(transform),
                get: (id) =>
                  transforms.get(id) ?? this.addressTransformRegistry.get(id),
                list: () => [
                  ...this.addressTransformRegistry.list(),
                  ...transforms.list(),
                ],
              },
            },
          });
        },
      },
      entrySource: next.entrySource,
      executionMode: "same-process",
    });
    if (!registered.ok) {
      this.report(
        pluginId,
        registered.error.code,
        registered.error.technicalMessage,
      );
      this.publish();
      return;
    }
    this.loaded.set(pluginId, { entrySource: next.entrySource });
    await this.registry.waitForActivation(pluginId);
    if (this.disposed) return;
    for (const issue of this.registry.getLoadErrors().slice(errorStart)) {
      if (issue.pluginId === pluginId)
        this.report(pluginId, issue.errorCode, issue.message);
    }
    if (!this.registry.isEnabled(pluginId)) {
      state.stage = "failed";
    } else {
      state.stage = "active";
      for (const id of dataTypes.list()) {
        const handlers = dataTypes.get(id);
        if (handlers !== undefined)
          this.dataTypeResolver.register(id, handlers);
      }
      for (const transform of transforms.list())
        this.addressTransformRegistry.register(transform);
      state.contributions = {
        protocolIds: [...codecIds],
        dataTypeIds: dataTypes.list(),
        addressTransformIds: transforms.list().map((item) => item.id),
      };
      this.transforms.set(pluginId, transforms);
    }
    this.publish();
  }

  private report(
    pluginId: string,
    code: string,
    technicalMessage: string,
  ): void {
    const state = this.states.get(pluginId);
    if (state !== undefined) {
      if (
        !state.errors.some(
          (error) =>
            error.code === code && error.technicalMessage === technicalMessage,
        )
      ) {
        state.errors.push({ code, technicalMessage });
      }
      if (code !== "PLUGIN_VERSION_WARNING") {
        state.stage = "failed";
        state.contributions = {
          protocolIds: [],
          dataTypeIds: [],
          addressTransformIds: [],
        };
      }
    }
    this.deps.onIssue?.({ pluginId, code, technicalMessage });
  }
}

/** 便捷构造（宿主装配点用）。 */
export function createHostPluginRuntime(
  deps: HostPluginRuntimeDeps,
): HostPluginRuntime {
  return new HostPluginRuntime(deps);
}
