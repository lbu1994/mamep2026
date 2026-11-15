/**
 * 装配编排 → UI store 的适配（composition root）。
 *
 * `host-assembly.ts` 只依赖 `HostAssemblySinks` 接口（不 import store / React，便于 node 环境
 * 单测）；真实实现放在此处，经 `useAppStore.getState()` **按调用时刻取最新状态**（避免闭包捕获
 * 过期快照——轮询结果要读到当前工作区表）。
 */
import type { AppHost } from "@mamep2026/ui";
import { useAppStore } from "@mamep2026/ui";
import type { HostAssemblySinks } from "./host-assembly";

export interface StoreSinksDeps {
  /** 登记活动 host（`App.tsx` 的 `hostRef`；工作区变更订阅据其调用 host 端口）。 */
  setActiveHost(host: AppHost): void;
}

/** 用 store 动作实现装配写入端口。 */
export function createStoreSinks(deps: StoreSinksDeps): HostAssemblySinks {
  const store = () => useAppStore.getState();
  return {
    setHostStatus: (status) => store().setHostStatus(status),
    setPluginsReady: (ready) => store().setPluginsReady(ready),
    setHost: (host) => store().setHost(host),
    setActiveHost: deps.setActiveHost,
    setDataTypeResolver: (resolver) => store().setDataTypeResolver(resolver),
    setWorkspace: (workspace) => store().setWorkspace(workspace),
    setLoaded: () => store().setLoaded(),
    setConnectionModalOpen: (open) => store().setConnectionModalOpen(open),
    setSaveStatus: (status) => store().setSaveStatus(status),
    setConnectionState: (state) => store().setConnectionState(state),
    setWorkspaceRecovery: (info) => store().setWorkspaceRecovery(info),
    appendMessage: (message) => store().appendMessage(message),
    appendCommLog: (entry) => store().appendCommLog(entry),
    recordPollResult: (key, result) => store().recordPollResult(key, result),
    updateRow: (key, updater) => store().updateRow(key, updater),
    getWorkspaceSheets: () => store().workspace.sheets,
  };
}
