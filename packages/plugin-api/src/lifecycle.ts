/**
 * 插件生命周期骨架（docs/插件功能设计.md §3.3，ADR-039）。
 * 状态机 + 错误隔离：Phase A 不加载第三方 entry 代码（隔离机制属 Phase F，另立 ADR），
 * 仅支持内置同进程 runtime（activate/deactivate）作为最小执行面；activate 抛错 →
 * PLUGIN_HOOK_FAILED → 禁用故障贡献点 → 核心保持可用。
 * Phase F（2026-09-01，ADR-044）：新增 PluginRemoteRuntime——第三方 entry 在隔离线程
 * （web Worker / Node worker_threads）执行，经 PluginCommunicationApi 代理桥与主线程通信。
 */
import type { Result } from "@mamep2026/domain";
import type { PluginCommunicationApi } from "./plugin-communication-api";
import type { PluginManifest } from "./manifest";

export type PluginLifecycleState =
  | "registered" // 已注册、无 runtime（纯清单贡献）
  | "active" // runtime.activate 成功
  | "deactivated" // 已禁用 / deactivate 已执行
  | "failed"; // activate/deactivate 抛错（贡献被禁用，插件仍可见于管理列表）

/** 内置同进程插件运行时（ADR-039 最小执行面；第三方代码隔离见 PluginRemoteRuntime）。 */
export interface PluginRuntime {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
  /** 释放运行时资源（可选；远程运行时关闭隔离线程用）。 */
  dispose?(): void | Promise<void>;
}

/**
 * 隔离线程插件运行时（2026-09-01，ADR-044 Phase F-2）：第三方 entry 在隔离线程加载执行。
 * 平台实现：浏览器 = Web Worker（Blob URL）；Node（Electron 主进程 / VSCode Extension Host）
 * = worker_threads。load() 在隔离线程 import entry 并提取 manifest（序列化回主线程），
 * activate 在隔离线程执行插件 activate；唯一外部通道为 PluginCommunicationApi 代理桥。
 */
export interface PluginRemoteRuntime {
  /** 在隔离线程加载 entry 并提取 manifest（单文件 JS 的 manifest 在 entry 内）。 */
  load(): Promise<Result<PluginManifest>>;
  /** 在隔离线程执行插件 activate（失败 → PLUGIN_HOOK_FAILED 错误隔离）。 */
  activate(ctx: PluginContext): Promise<void>;
  /** 在隔离线程执行插件 deactivate（可选）。 */
  deactivate?(): Promise<void>;
  /** 关闭隔离线程并释放资源。 */
  dispose(): Promise<void>;
}

/** 传给 activate/deactivate 的插件上下文。 */
export interface PluginContext {
  pluginId: string;
  /** 唯一通信面（不暴露 Transport / socket 句柄，经统一调度器）。 */
  communication: PluginCommunicationApi;
}

export const PLUGIN_LOAD_FAILED = "PLUGIN_LOAD_FAILED";
export const PLUGIN_HOOK_FAILED = "PLUGIN_HOOK_FAILED";
