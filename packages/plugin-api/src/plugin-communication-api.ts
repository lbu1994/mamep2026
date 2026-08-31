/**
 * PluginCommunicationApi（docs/插件功能设计.md §3.4，ADR-039）。
 * 插件唯一通信面：不暴露 Transport / socket 句柄；请求经统一调度器（RequestScheduler）执行，
 * 元数据 source:"plugin" + pluginId + 默认 RequestPriority:"plugin-background"；权限门
 * （communication）。具体工厂 createPluginCommunicationApi 落在 packages/application
 * （plugin-api 不依赖 communication，保持分层）。Phase A 实现 read/write；
 * batchRead / trace 接口在 Phase F 随可执行插件扩展。
 */
import { createMamepError, fail, type Result } from "@mamep2026/domain";

export interface PluginReadRequest {
  address: number;
  quantity: number;
}

export interface PluginWriteRequest {
  address: number;
  values: number[];
}

export interface PluginCommunicationApi {
  readRegisters(req: PluginReadRequest): Promise<Result<number[]>>;
  writeRegisters(req: PluginWriteRequest): Promise<Result<void>>;
}

export const PLUGIN_RUNTIME_NOT_AVAILABLE = "PLUGIN_RUNTIME_NOT_AVAILABLE";

/** 无可用会话时的兜底 API（宿主未装配会话时使用；Phase A 无执行，仅契约占位）。 */
export function createUnavailableCommunicationApi(): PluginCommunicationApi {
  const unavailable = (operation: string) =>
    createMamepError({
      code: PLUGIN_RUNTIME_NOT_AVAILABLE,
      category: "plugin",
      userMessageKey: "errors.pluginRuntimeNotAvailable",
      technicalMessage: `plugin communication ${operation} unavailable: no session`,
    });
  return {
    async readRegisters() {
      return fail(unavailable("read"));
    },
    async writeRegisters() {
      return fail(unavailable("write"));
    },
  };
}
