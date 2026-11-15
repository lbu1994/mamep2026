/**
 * 「首次打开后保持挂载」门控（构建产物代码分割）。
 *
 * 懒加载（`React.lazy`）的弹窗/抽屉组件有两种挂载策略，直接条件挂载或始终挂载都有问题：
 * - 始终渲染：首屏即会拉取该 chunk，按需加载失效（体积优化落空）；
 * - 严格按 `open` 挂载：关闭瞬间组件被卸载，antd 的退场动画直接消失（视觉回归）。
 *
 * 本 hook 取折中：`open` 首次为 true 后返回值恒为 true——即**首次打开才挂载**（chunk 按需下载），
 * 此后组件常驻，显隐仍由组件自身的 `open` 属性控制（关闭动画保留）。
 *
 * 实现用 React 官方文档的「prop 变化时在渲染期调整自身 state」模式：不要在 effect 里同步
 * setState（`react-hooks/set-state-in-effect` 报错，且会多一次「挂载后立刻重渲染」）。
 */
import { useState } from "react";

/** `open` 首次为 true 后恒返回 true（初值为 true 时立即为 true）。 */
export function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) {
    // 渲染期更新自身状态（而非 effect）：React 立即用新 state 重渲染，本次即输出挂载结果。
    setOpened(true);
  }
  return opened;
}
