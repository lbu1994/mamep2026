/**
 * App 级全局快捷键 hook（PRD §8.3 P1，2026-08-30，ADR-037）。
 * 窗口级 keydown 监听只绑定一次，经 ref 读取最新动作映射（keydownRef 模式，
 * 与 RegisterTable 一致，防陈旧闭包）。
 * 守卫顺序：① 焦点在文本输入控件 → 忽略；② 任一弹窗打开 → 忽略；
 * ③ 命中注册表（APP_SHORTCUTS）→ preventDefault + 分发动作（首个匹配即消费）。
 */
import { useEffect, useRef } from "react";
import {
  APP_SHORTCUTS,
  matchesShortcut,
  type AppShortcutId,
} from "./shortcuts";
import { isAnyModalOpen, isTextInputTarget } from "./guards";

export type GlobalShortcutActions = Partial<Record<AppShortcutId, () => void>>;

export function useGlobalShortcuts(actions: GlobalShortcutActions): void {
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (isTextInputTarget(event.target)) return;
      if (isAnyModalOpen()) return;
      const current = actionsRef.current;
      for (const def of APP_SHORTCUTS) {
        if (matchesShortcut(event, def.combo)) {
          const action = current[def.id as AppShortcutId];
          if (action !== undefined) {
            event.preventDefault();
            action();
          }
          return;
        }
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}
