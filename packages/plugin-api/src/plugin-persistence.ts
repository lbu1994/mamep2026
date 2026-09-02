/**
 * 插件持久化协调器（ADR-038，2026-08-30；2026-09-02 插件外部化扩展）。
 * 对齐 packages/workspace 的 AutoSaveCoordinator 模式：
 * - init()：订阅 registry 事件（registered / enabled-changed / unregistered），并从 store 异步 hydrate
 *   （把已安装插件注册进 PluginRegistry + 恢复启用状态）；hydrate 期间抑制持久化；
 * - 事件触发立即保存快照（插件数量小、无防抖必要）；
 * - 保存失败不丢内存状态，经 onError 回调上报（宿主可接入 app-message 提示）；
 * - 随包插件一次性安装（2026-09-02，插件外部化）：seeded=false 时装配方自动安装随包插件
 *   （register + persist 快照），随后 markSeeded() 落盘；此后随包插件与用户安装插件等同
 *   （卸载=从快照删除、禁用=enabled 覆盖），重启经 hydrate 恢复（同进程 runtime 由装配方
 *   按代码清单重新附加，见 PluginRegistry.attachRuntime）。
 */
import type { Result } from "@mamep2026/domain";
import { ok } from "@mamep2026/domain";
import type { PluginStorePort } from "./plugin-store";
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
  private hydrating = false;
  /** 随包插件一次性安装是否已完成（v3 schema；init 时从 store 读入，persist 时写回）。 */
  private seeded = false;

  constructor(
    registry: PluginRegistry,
    store: PluginStorePort,
    deps: PluginPersistenceDeps = {},
  ) {
    this.registry = registry;
    this.store = store;
    this.deps = deps;
  }

  /** 启动：订阅事件 + 异步 hydrate（幂等，重复调用为 no-op）。 */
  async init(): Promise<Result<void>> {
    if (this.unsubscribe !== null) return ok(undefined);
    this.unsubscribe = this.registry.subscribe(() => {
      // hydrate 期间 register/setEnabled 会触发事件，抑制避免中间态反复落盘。
      if (this.hydrating) return;
      void this.persist();
    });

    this.hydrating = true;
    try {
      const result = await this.store.load();
      if (!result.ok) return result;
      this.seeded = result.value.seeded;
      this.registry.hydrate(result.value);
      return ok(undefined);
    } finally {
      this.hydrating = false;
    }
  }

  /** 随包插件一次性安装是否已完成（2026-09-02 插件外部化）：装配方据此决定自动安装/忽略。 */
  isSeeded(): boolean {
    return this.seeded;
  }

  /** 标记随包插件一次性安装完成（装配方自动安装后调用）：随下次持久化写回 seeded=true。 */
  markSeeded(): void {
    this.seeded = true;
  }

  /** 立即保存当前快照（应用关闭/卸载前调用，尽力而为）。 */
  async flush(): Promise<Result<void>> {
    return this.persist();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async persist(): Promise<Result<void>> {
    const snapshot = this.registry.snapshot();
    const result = await this.store.save({
      schemaVersion: snapshot.schemaVersion,
      plugins: snapshot.plugins,
      seeded: this.seeded,
    });
    if (!result.ok) {
      this.deps.onError?.(result.error);
    }
    return result;
  }
}
