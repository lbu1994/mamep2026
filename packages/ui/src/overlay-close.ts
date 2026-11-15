/**
 * 覆盖层关闭栈（移动端返回键语义）。
 *
 * 返回键的约定是「先关最上层覆盖层，没有则最小化应用」。UI 层可能有多种覆盖层
 * （移动端侧栏抽屉、底部面板抽屉、antd Modal / Drawer 等），因此用一个**后进先出**的
 * 注册表统一管理：各覆盖层在打开期间注册自己的关闭函数，返回键取栈顶执行。
 *
 * 与 DOM 探测相比：真正的关闭需要触发组件的 `onClose`（状态回写），DOM 探测做不到。
 */
import { useEffect, useRef } from "react";

type OverlayCloseHandler = () => void;

const stack: OverlayCloseHandler[] = [];

/** 注册一个覆盖层关闭函数（打开时调用）。 */
export function pushOverlayClose(handler: OverlayCloseHandler): void {
  stack.push(handler);
}

/** 注销（关闭 / 卸载时调用）；不在栈中则忽略。 */
export function removeOverlayClose(handler: OverlayCloseHandler): void {
  const index = stack.lastIndexOf(handler);
  if (index >= 0) stack.splice(index, 1);
}

/**
 * 关闭并移除最上层覆盖层。
 *
 * 先弹栈再调用：即使 handler 内部再触发一次返回键（重入），也只会继续关下一层，
 * 不会重复调用同一个 handler；组件随后的 effect cleanup 注销时会安全地忽略（已不在栈中）。
 *
 * @returns 有覆盖层被关闭返回 `true`；栈为空返回 `false`（调用方据此最小化应用）。
 */
export function closeTopOverlay(): boolean {
  const handler = stack.pop();
  if (handler === undefined) return false;
  handler();
  return true;
}

/** 当前栈深度（供返回键路由与测试断言）。 */
export function overlayCloseStackSize(): number {
  return stack.length;
}

/** 清空（`AppHost.dispose()` / 测试隔离用）。 */
export function clearOverlayCloseStack(): void {
  stack.length = 0;
}

/**
 * 在覆盖层打开期间把 `onClose` 注册进栈。
 *
 * `onClose` 每次渲染通常是新函数，故用 ref 存最新值、注册稳定的包装函数，
 * 避免 effect 反复注销/重注册导致栈顺序错乱。
 */
export function useOverlayClose(
  open: boolean,
  onClose: OverlayCloseHandler,
): void {
  const handlerRef = useRef(onClose);
  useEffect(() => {
    handlerRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const entry = (): void => handlerRef.current();
    pushOverlayClose(entry);
    return () => removeOverlayClose(entry);
  }, [open]);
}
