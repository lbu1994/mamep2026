/**
 * PluginCommunicationApi 工厂（docs/插件功能设计.md §3.4，ADR-039）。
 * 组装 CommunicationSession 的插件通信面：请求经统一调度器（RequestScheduler）执行，
 * 元数据 source:"plugin" + pluginId + RequestPriority:"plugin-background"，日志携带
 * pluginId（CommunicationLogEvent.pluginId）。不暴露 Transport / socket 句柄。
 * Phase A 实现 readRegisters / writeRegisters；batchRead / trace 随 Phase F 扩展。
 */
import type { CommunicationSession } from "@mamep2026/communication";
import {
  createMamepError,
  fail,
  ok,
  type RequestRoute,
} from "@mamep2026/domain";
import {
  PLUGIN_RUNTIME_NOT_AVAILABLE,
  type PluginCommunicationApi,
} from "@mamep2026/plugin-api";

export interface PluginCommunicationDeps {
  /** 当前会话提供器（未连接/无会话时返回 null → 能力错误）。 */
  getSession: () => CommunicationSession | null;
  /** 调用创建时读取一次活动路由；会话内部会再固化快照。 */
  getRoute?: () => RequestRoute | null;
  /** 调用方插件 id（写入通信日志）。 */
  pluginId: string;
}

function unavailableError(operation: string) {
  return createMamepError({
    code: PLUGIN_RUNTIME_NOT_AVAILABLE,
    category: "plugin",
    userMessageKey: "errors.pluginRuntimeNotAvailable",
    technicalMessage: `plugin communication ${operation} unavailable: no session`,
  });
}

/** 构造插件通信面（ADR-039）；宿主在装配 PluginRegistry 时注入。 */
export function createPluginCommunicationApi(
  deps: PluginCommunicationDeps,
): PluginCommunicationApi {
  const { getSession, getRoute, pluginId } = deps;
  const pluginMeta = {
    source: "plugin" as const,
    pluginId,
    priority: "plugin-background" as const,
  };
  return {
    async readRegisters(req) {
      const session = getSession();
      if (session === null) return fail(unavailableError("read"));
      const route = getRoute?.() ?? session.getCurrentRoute();
      return session.readRegisters(req.address, req.quantity, {
        ...pluginMeta,
        route,
      });
    },
    async writeRegisters(req) {
      const session = getSession();
      if (session === null) return fail(unavailableError("write"));
      const result = await session.writeRegisters(req.address, req.values, {
        ...pluginMeta,
        route: getRoute?.() ?? session.getCurrentRoute(),
      });
      return result.ok ? ok(undefined) : result;
    },
  };
}
