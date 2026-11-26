/**
 * PluginCommunicationApi 工厂（docs/architecture/ports/plugin-api/插件契约.md §4）。
 * 组装 CommunicationSession 的插件通信面：请求经统一调度器（RequestScheduler）执行，
 * 元数据 source:"plugin" + pluginId + RequestPriority:"plugin-background"，日志携带
 * pluginId（CommunicationLogEvent.pluginId）。不暴露 Transport / socket 句柄。
 *  实现 readRegisters / writeRegisters；batchRead / trace 随扩展。
 */
import {
  createCancellationToken,
  type CommunicationSession,
} from "@mamep2026/communication";
import {
  createMamepError,
  fail,
  ok,
  type RequestRoute,
} from "@mamep2026/domain";
import {
  PLUGIN_RUNTIME_NOT_AVAILABLE,
  deniedPluginAuthorization,
  type PluginAuthorization,
  type PluginCommunicationApi,
} from "@mamep2026/plugin-api";

export interface PluginCommunicationDeps {
  /** 当前会话提供器（未连接/无会话时返回 null → 能力错误）。 */
  getSession: () => CommunicationSession | null;
  /** 调用创建时读取一次活动路由；会话内部会再固化快照。 */
  getRoute?: () => RequestRoute | null;
  /** 调用方插件 id（写入通信日志）。 */
  pluginId: string;
  /** Host-owned permission and runtime checks. Missing access fails closed. */
  authorization?: PluginAuthorization;
}

function unavailableError(operation: string) {
  return createMamepError({
    code: PLUGIN_RUNTIME_NOT_AVAILABLE,
    category: "plugin",
    userMessageKey: "errors.pluginRuntimeNotAvailable",
    technicalMessage: `plugin communication ${operation} unavailable: no session`,
  });
}

/** 构造插件通信面；宿主在装配 PluginRegistry 时注入。 */
export function createPluginCommunicationApi(
  deps: PluginCommunicationDeps,
): PluginCommunicationApi {
  const { getSession, getRoute, pluginId } = deps;
  const authorization = deps.authorization ?? deniedPluginAuthorization;
  const pluginMeta = {
    source: "plugin" as const,
    pluginId,
    priority: "plugin-background" as const,
  };
  return {
    async readRegisters(req) {
      const allowed = authorization.check("read");
      if (!allowed.ok) return allowed;
      const session = getSession();
      if (session === null) return fail(unavailableError("read"));
      const cancelToken = createCancellationToken();
      const unsubscribe = authorization.onRevoke(() => {
        cancelToken.cancel();
        session.cancelPendingRequests();
      });
      try {
        const result = await session.readRegisters(req.address, req.quantity, {
          ...pluginMeta,
          route: getRoute?.() ?? session.getCurrentRoute(),
          cancelToken,
          beforeSend: () => authorization.check("read"),
        });
        const current = authorization.check("read");
        return current.ok ? result : current;
      } finally {
        unsubscribe();
      }
    },
    async writeRegisters(req) {
      const allowed = authorization.check("write");
      if (!allowed.ok) return allowed;
      const session = getSession();
      if (session === null) return fail(unavailableError("write"));
      const cancelToken = createCancellationToken();
      const unsubscribe = authorization.onRevoke(() => {
        cancelToken.cancel();
        session.cancelPendingRequests();
      });
      try {
        const result = await session.writeRegisters(
          req.address,
          [...req.values],
          {
            ...pluginMeta,
            route: getRoute?.() ?? session.getCurrentRoute(),
            cancelToken,
            beforeSend: () => authorization.check("write"),
          },
        );
        const current = authorization.check("write");
        if (!current.ok) return current;
        return result.ok ? ok(undefined) : result;
      } finally {
        unsubscribe();
      }
    },
  };
}
