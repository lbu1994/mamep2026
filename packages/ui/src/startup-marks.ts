/** 仅在浏览器记录 UI 启动阶段边界；不采集数据、不上传、不改变交互流程。 */
export function markUiStartup(stage: string): void {
  if (typeof performance === "undefined") return;
  performance.mark(`mamep:ui:${stage}`);
}
