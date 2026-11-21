/**
 * 把较重的状态提交移出当前输入事件任务。
 *
 * Event Timing 的 duration 会覆盖输入事件处理及紧随其后的渲染；1000 行表格重建、
 * 弹窗首次挂载等同步工作应留到下一个宏任务。调用方负责保证提交函数幂等，并可
 * 在组件卸载时调用返回的取消函数。
 */
export function scheduleAfterInput(commit: () => void): () => void {
  const timer = globalThis.setTimeout(commit, 0);
  return () => globalThis.clearTimeout(timer);
}
