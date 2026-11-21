/**
 * 启动阶段时间线（浏览器 Performance Timeline）。
 *
 * mark 只记录当前阶段边界，不采集数据、不上传，也不改变启动流程；供生产性能验收
 * 判断 Long Task 归属，避免把工作区恢复、React 提交和插件恢复混成一个指标。
 */
export type StartupStage =
  | "bootstrap"
  | "host-load-start"
  | "host-loaded"
  | "host-constructed"
  | "workspace-start"
  | "workspace-settled"
  | "interactive"
  | "deferred-start"
  | "plugins-settled";

export function markStartup(stage: StartupStage): void {
  if (typeof performance === "undefined") return;
  performance.mark(`mamep:startup:${stage}`);
}
