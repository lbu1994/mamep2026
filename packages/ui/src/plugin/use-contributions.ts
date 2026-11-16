/**
 * 插件贡献响应式读取（docs/architecture/ports/plugin-api/插件契约.md §3）。
 * UI 消费方经 host.pluginRegistry 读取贡献：本 hook 用 useSyncExternalStore 订阅注册表事件
 * （注册/启停/生命周期变化），保证安装/启停插件后消费方自动重渲染。
 */
import { useSyncExternalStore } from "react";
import type { Contribution, ContributionPointId } from "@mamep2026/plugin-api";
import type { PluginHost } from "../host";

/** 响应式读取某贡献点的有效贡献：host 为空返回空数组。 */
export function usePluginContributions<T>(
  host: PluginHost | null,
  pointId: ContributionPointId,
): Contribution<T>[] {
  const registry = host?.pluginRegistry ?? null;
  useSyncExternalStore(
    (callback) => {
      if (registry === null) return () => {};
      return registry.subscribe(callback);
    },
    () => registry?.getVersion() ?? 0,
  );
  return registry?.getContributions<T>(pointId) ?? [];
}
