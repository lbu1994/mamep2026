/**
 * useGlobalShortcuts hook 单测（PRD §8.3 P1，2026-08-30，ADR-037）。
 * 覆盖：命中注册表分发、文本输入守卫、弹窗打开抑制、动作映射经 ref 防陈旧闭包。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useAppStore } from "../app-store";
import {
  useGlobalShortcuts,
  type GlobalShortcutActions,
} from "./useGlobalShortcuts";

function Harness({ actions }: { actions: GlobalShortcutActions }): null {
  useGlobalShortcuts(actions);
  return null;
}

function fireAppKey(
  target: Element | Document | Window,
  key: string,
  mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
): void {
  fireEvent.keyDown(target, {
    key,
    ctrlKey: mods.ctrl ?? false,
    metaKey: mods.meta ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
  });
}

beforeEach(() => {
  useAppStore.setState({
    connectionModalOpen: false,
    settingsModalOpen: false,
    pluginModalOpen: false,
    helpModalOpen: false,
    workspaceImportDraft: null,
    pendingDeleteSheetId: null,
    pendingBulkClose: null,
  });
});

describe("useGlobalShortcuts", () => {
  it("命中注册表组合时调用对应动作（Ctrl+, → openSettings）", () => {
    const openSettings = vi.fn();
    render(<Harness actions={{ openSettings }} />);
    fireAppKey(window, ",", { ctrl: true });
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("未注册的动作 id 不报错、不调用（无默认动作）", () => {
    render(<Harness actions={{}} />);
    expect(() => fireAppKey(window, ",", { ctrl: true })).not.toThrow();
  });

  it("焦点在文本输入控件时不触发（Ctrl+, 被输入框守卫拦截）", () => {
    const openSettings = vi.fn();
    const { container } = render(
      <>
        <Harness actions={{ openSettings }} />
        <input data-testid="inp" />
      </>,
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[data-testid="inp"]',
    )!;
    input.focus();
    fireAppKey(input, ",", { ctrl: true });
    expect(openSettings).not.toHaveBeenCalled();
  });

  it("任一弹窗打开时抑制（settingsModalOpen → Ctrl+, 不触发）", () => {
    const openSettings = vi.fn();
    useAppStore.setState({ settingsModalOpen: true });
    render(<Harness actions={{ openSettings }} />);
    fireAppKey(window, ",", { ctrl: true });
    expect(openSettings).not.toHaveBeenCalled();
  });

  it("动作映射经 ref 防陈旧闭包：rerender 后按最新动作分发", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness actions={{ openSettings: first }} />);
    rerender(<Harness actions={{ openSettings: second }} />);
    fireAppKey(window, ",", { ctrl: true });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("别名组合（? = Shift+/）触发 openHelp 动作", () => {
    const openHelp = vi.fn();
    render(<Harness actions={{ openHelpQuestion: openHelp }} />);
    fireAppKey(window, "?", { shift: true });
    expect(openHelp).toHaveBeenCalledTimes(1);
  });
});
