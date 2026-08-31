/**
 * 插件生命周期骨架（docs/插件功能设计.md §3.3，ADR-039）。
 * 状态机 + 错误隔离：Phase A 不加载第三方 entry 代码（隔离机制属 Phase F，另立 ADR），
 * 仅支持内置同进程 runtime（activate/deactivate）作为最小执行面；activate 抛错 →
 * PLUGIN_HOOK_FAILED → 禁用故障贡献点 → 核心保持可用。
 */
import type { PluginCommunicationApi } from "./plugin-communication-api";

export type PluginLifecycleState =
  | "registered" // 已注册、无 runtime（纯清单贡献）
  | "active" // runtime.activate 成功
  | "deactivated" // 已禁用 / deactivate 已执行
  | "failed"; // activate/deactivate 抛错（贡献被禁用，插件仍可见于管理列表）

/** 内置同进程插件运行时（Phase A 最小执行面；entry 加载属 Phase F）。 */
export interface PluginRuntime {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/** 传给 activate/deactivate 的插件上下文。 */
export interface PluginContext {
  pluginId: string;
  /** 唯一通信面（不暴露 Transport / socket 句柄，经统一调度器）。 */
  communication: PluginCommunicationApi;
}

export const PLUGIN_LOAD_FAILED = "PLUGIN_LOAD_FAILED";
export const PLUGIN_HOOK_FAILED = "PLUGIN_HOOK_FAILED";
