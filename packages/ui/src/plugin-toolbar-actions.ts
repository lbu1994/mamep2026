/**
 * 插件工具栏动作执行（插件外部化）。
 * toolbarAction 为声明式描述；安川插件的 ROM/RAM 确定指令
 * （enter-rom / enter-ram）由插件自身执行
 * （PluginRuntime.handleToolbarAction，经 PluginCommunicationApi 走统一调度器写
 * 0900H/0910H），核心（packages/ui）不再硬编码厂商地址/写入规则（docs/AGENTS.md §24.4）。
 * 本模块仅保留平台侧通用执行前置（连接检查 + 消息提示）与代理调用。
 */
import type { ApplicationMessage } from "@mamep2026/logging";
import type { AppHost } from "./host";

export interface PluginToolbarActionDeps {
  appendMessage: (message: ApplicationMessage) => void;
}

/**
 * 执行插件工具栏动作（经 PluginRegistry 委托插件同进程 runtime）。
 * 前置：已连接（否则提示）；确认流程由 UI 层按贡献点 confirmKey 处理（此处不重复）。
 */
export async function runPluginToolbarAction(
  host: AppHost,
  pluginId: string,
  actionId: string,
  deps: PluginToolbarActionDeps,
): Promise<void> {
  if (host.getConnectionState() !== "connected") {
    deps.appendMessage({
      timestamp: Date.now(),
      level: "warning",
      messageKey: "errors.notConnected",
      params: {},
      detail: null,
    });
    return;
  }
  const result = await host.pluginRegistry.invokeToolbarAction(
    pluginId,
    actionId,
  );
  if (result.ok) {
    deps.appendMessage({
      timestamp: Date.now(),
      level: "info",
      messageKey: "plugins.actionSucceeded",
      params: {},
      detail: null,
    });
  } else {
    deps.appendMessage({
      timestamp: Date.now(),
      level: "error",
      messageKey: "messages.writeFailed",
      params: { detail: result.error.code },
      detail: result.error.code,
    });
  }
}
