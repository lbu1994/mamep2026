/**
 * 插件持久化协调器（去除随包插件一次性安装）。
 * 对齐 packages/workspace 的 AutoSaveCoordinator 模式：
 * - start()：订阅 registry 事件（registered / enabled-changed / unregistered）并立即保存快照
 *   （插件数量小、无防抖必要）；hydrate 由装配方承担（需先异步加载执行面，见 start 注释）；
 * - 保存失败不丢内存状态，经 onError 回调上报（宿主可接入 app-message 提示）。
 * 插件一律由用户手动安装，不再有「随包自动安装」与 seeded 装配状态；
 * 执行面（同进程 / 隔离）由 StoredPlugin.executionMode 记录，重启后由装配方按此重建。
 */
import { ok, type Result } from "@mamep2026/domain";
import type { PluginStorePort, PluginStoreSnapshot } from "./plugin-store";
import type { PluginRegistry } from "./registry";

export interface PluginPersistenceDeps {
  /** 保存失败回调（可选；宿主可接入应用消息提示，如 app-message）。 */
  onError?: (error: unknown) => void;
}

export class PluginPersistenceCoordinator {
  private readonly registry: PluginRegistry;
  private readonly store: PluginStorePort;
  private readonly deps: PluginPersistenceDeps;
  private unsubscribe: (() => void) | null = null;
  private pendingSnapshot: PluginStoreSnapshot | null = null;
  private saving: Promise<Result<void>> | null = null;

  constructor(
    registry: PluginRegistry,
    store: PluginStorePort,
    deps: PluginPersistenceDeps = {},
  ) {
    this.registry = registry;
    this.store = store;
    this.deps = deps;
  }

  /**
   * 订阅注册表事件并持久化（幂等，重复调用为 no-op）。
   * hydrate 由装配方承担：它需先异步加载插件执行面（同进程 / 隔离）才能带 runtime
   * 注册，故本协调器不再自行 load/hydrate。
   */
  start(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = this.registry.subscribe((event) => {
      if (event.type === "host-state-changed") return;
      this.registry.markHostPluginPending(event.pluginId);
      void this.persist();
    });
  }

  /** 立即保存当前快照（应用关闭/卸载前调用，尽力而为）。 */
  async flush(): Promise<Result<void>> {
    return this.persist();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private persist(): Promise<Result<void>> {
    // Capture before waiting; host disposal later clears the live registry.
    this.pendingSnapshot = this.registry.snapshot();
    if (this.saving !== null) return this.saving;
    this.saving = Promise.resolve().then(async () => {
      let result: Result<void> = ok(undefined);
      try {
        while (this.pendingSnapshot !== null) {
          const snapshot = this.pendingSnapshot;
          this.pendingSnapshot = null;
          result = await this.saveSnapshot(snapshot);
        }
        if (result.ok) this.registry.completeHostPluginSync();
        return result;
      } finally {
        this.saving = null;
      }
    });
    return this.saving;
  }

  private async saveSnapshot(
    snapshot: PluginStoreSnapshot,
  ): Promise<Result<void>> {
    const result = await this.store.save({
      schemaVersion: snapshot.schemaVersion,
      plugins: snapshot.plugins,
    });
    if (!result.ok) {
      this.deps.onError?.(result.error);
    }
    return result;
  }
}
