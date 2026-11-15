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
 * - 同步策略：按「已启用 same-process 插件集合签名（id + entrySource）」比对，**变化即全量重建**
 *   （先注销全部宿主插件，再以**新建的** dataType / addressTransform 注册表重新加载并激活）。
 *   全量重建是必要的：`DataTypeRegistry` / `AddressTransformRegistry` 没有注销 API，
 *   复用旧注册表会让**已卸载 / 已禁用插件的变换在宿主侧继续生效**（地址被静默 −1），
 *   与渲染端（能力矩阵已移除）不一致。插件数量极少、同步很稀疏，重建成本可忽略。
 * - `codecRegistry` 是**稳定引用**（宿主会话在构造时持有）：`CodecRegistry` 无注销 API，
 *   卸载后其 codec 仍留在宿主注册表中 —— 该残留无害（渲染端已移除该协议入口，
 *   宿主不会再收到该 codecId 的会话请求）。
 * - `ctx.registries` 由宿主提供：codec（宿主会话 codec 注册表）、dataType（Node 侧
 *   `createDataTypeResolver()`，纯 TS 可在宿主运行）、addressTransform（宿主注册表）。
 * - 错误隔离：加载 / activate 失败只影响该插件（记录错误），不影响宿主会话与其它插件。
 * - **不做跨进程能力回传**：宿主加载失败时渲染端仍会显示该协议，
 *   表现为连接失败（见开发指南）。
 */
import {
  createDataTypeResolver,
  type DataTypeResolver,
} from "@mamep2026/data-conversion";
import {
  createCodecRegistry,
  type CodecRegistry,
} from "@mamep2026/communication";
import { ok, type AddressTransform } from "@mamep2026/domain";
import {
  PluginRegistry,
  createAddressTransformRegistry,
  pluginManifestSchema,
  runtimeFromLocalEntry,
  type AddressTransformRegistry,
  type PluginManifest,
  type PluginStorePort,
  type PluginSyncRegistries,
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
}

/** 安全提取清单 id（清单可能坏到不是对象，上报时不能抛错）。 */
function manifestIdOf(manifest: unknown): string {
  if (typeof manifest === "object" && manifest !== null) {
    const id = (manifest as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return "";
}

/** 同一份 same-process 插件集合的标识（id + entrySource），用于判断是否需全量重建。 */
function setSignature(desired: Map<string, { entrySource: string }>): string {
  return [...desired.entries()]
    .map(([id, value]) => `${id}@${value.entrySource}`)
    .sort()
    .join("|");
}

export class HostPluginRuntime {
  private readonly deps: HostPluginRuntimeDeps;
  private readonly registry: PluginRegistry;
  /** 宿主会话 codec 注册表（稳定引用；codec 无注销 API，见头注释已知限制）。 */
  private readonly codecRegistry: CodecRegistry;
  private readonly syncRegistries: PluginSyncRegistries;
  /** 当前 dataType / addressTransform 注册表（集合变化时整体重建）。 */
  private dataTypeResolver: DataTypeResolver;
  private addressTransformRegistry: AddressTransformRegistry;
  /** 已加载插件（id → { entrySource }）与集合签名（均只含已启用 same-process 插件）。 */
  private loaded = new Map<string, { entrySource: string }>();
  private signature: string | null = null;
  /** 已上报的 registry 加载错误条数（避免重建时重复上报历史错误）。 */
  private reportedErrors = 0;
  private syncing = false;

  constructor(deps: HostPluginRuntimeDeps) {
    this.deps = deps;
    this.codecRegistry = deps.codecRegistry ?? createCodecRegistry();
    this.dataTypeResolver = createDataTypeResolver();
    this.addressTransformRegistry = createAddressTransformRegistry();
    // 委托式同步注册面：dataType / addressTransform 读**当前**注册表（支持重建后替换）。
    this.syncRegistries = {
      codec: {
        register: (codec) => {
          this.codecRegistry.register(codec);
          return ok(undefined);
        },
        list: () => this.codecRegistry.list(),
      },
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
    return this.addressTransformRegistry.get(transformId) ?? null;
  };

  /** 已由宿主加载的插件 id（诊断 / 测试用）。 */
  listLoadedPluginIds(): string[] {
    return [...this.loaded.keys()];
  }

  /**
   * 与插件存储同步（宿主启动 + 渲染端每次保存后调用）。
   * 只处理**已启用**的 same-process 可执行插件；集合（id + entrySource）变化即全量重建，
   * 未变化则直接返回（幂等）。并发调用串行化（syncing 守卫）。
   */
  async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const stored = await this.deps.store.load();
      if (!stored.ok) {
        this.report("", stored.error.code, stored.error.technicalMessage);
        return;
      }
      const desired = new Map<
        string,
        { manifest: PluginManifest; entrySource: string }
      >();
      for (const entry of stored.value.plugins) {
        if (entry.executionMode !== "same-process") continue;
        if (entry.enabled !== true) continue;
        if (entry.entrySource === undefined) continue;
        const parsed = pluginManifestSchema.safeParse(entry.manifest);
        if (!parsed.success) {
          this.report(
            manifestIdOf(entry.manifest),
            "PLUGIN_MANIFEST_INVALID",
            parsed.error.message,
          );
          continue;
        }
        desired.set(entry.manifest.id, {
          manifest: parsed.data,
          entrySource: entry.entrySource,
        });
      }

      const nextSignature = setSignature(desired);
      if (nextSignature === this.signature) return;
      await this.rebuild(desired);
      this.signature = nextSignature;
    } finally {
      this.syncing = false;
    }
  }

  /** 释放全部宿主插件（注销 + 清空注册表）；宿主退出时调用。 */
  dispose(): void {
    for (const pluginId of [...this.loaded.keys()]) {
      this.registry.unregister(pluginId);
    }
    this.loaded.clear();
    this.signature = null;
    this.reportedErrors = 0;
    this.dataTypeResolver = createDataTypeResolver();
    this.addressTransformRegistry = createAddressTransformRegistry();
  }

  /** 全量重建：注销全部 → 新建 dataType / addressTransform 注册表 → 重新加载并激活。 */
  private async rebuild(
    desired: Map<string, { manifest: PluginManifest; entrySource: string }>,
  ): Promise<void> {
    for (const pluginId of [...this.loaded.keys()]) {
      this.registry.unregister(pluginId);
    }
    this.loaded.clear();
    this.dataTypeResolver = createDataTypeResolver();
    this.addressTransformRegistry = createAddressTransformRegistry();

    for (const [pluginId, next] of desired) {
      const entryResult = await loadNodePluginEntry(next.entrySource);
      if (!entryResult.ok) {
        this.report(
          pluginId,
          entryResult.error.code,
          entryResult.error.technicalMessage,
        );
        continue;
      }
      const registered = this.registry.register(entryResult.value.manifest, {
        source: "installed",
        runtime: runtimeFromLocalEntry(entryResult.value),
        entrySource: next.entrySource,
        executionMode: "same-process",
      });
      if (!registered.ok) {
        this.report(
          pluginId,
          registered.error.code,
          registered.error.technicalMessage,
        );
        continue;
      }
      this.loaded.set(pluginId, { entrySource: next.entrySource });
    }

    // 加载 / 兼容性 / 贡献点问题上报（便于诊断；不重复上报历史错误）。
    const errors = this.registry.getLoadErrors();
    if (errors.length < this.reportedErrors) this.reportedErrors = 0;
    for (const error of errors.slice(this.reportedErrors)) {
      this.report(error.pluginId ?? "", error.errorCode, error.message);
    }
    this.reportedErrors = errors.length;
  }

  private report(
    pluginId: string,
    code: string,
    technicalMessage: string,
  ): void {
    this.deps.onIssue?.({ pluginId, code, technicalMessage });
  }
}

/** 便捷构造（宿主装配点用）。 */
export function createHostPluginRuntime(
  deps: HostPluginRuntimeDeps,
): HostPluginRuntime {
  return new HostPluginRuntime(deps);
}
