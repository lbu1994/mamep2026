/**
 * MamepApp Sheet 名重命名编辑态隔离测试（jsdom）。
 * 覆盖：
 * - 页签头进入编辑态时，侧边栏对应项不渲染输入框
 * - 页签头提交（Enter / 失焦）后名称在两处同步更新
 * - Escape 取消、失焦提交行为
 * - 输入框内按 Backspace 不冒泡到 Tabs 键盘删除逻辑（不关闭标签、不退出编辑态）
 * 编辑态为组件局部状态（非全局 store），相关 store 测试见 app-store.test.ts。
 * 侧边栏重命名入口仅为右键菜单 Rename（侧边栏双击进入更名已于 2026-08-21 移除）；
 * 右键菜单（Dropdown 弹层）在 jsdom 无法渲染弹层，其交互与提交/同步行为由 Playwright
 * e2e（tests/e2e-web/tests/sidebar-menu.spec.ts）覆盖。本文件保留页签头（双击）用例。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { createEmptyWorkspace } from "@mamep2026/domain";
import { initI18n } from "./i18n";
import { useAppStore } from "./app-store";
import { MamepApp } from "./MamepApp";

function tabRenameInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    ".register-table-tabs .sheet-tab__input",
  );
}

function sidebarRenameInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    ".sheet-sidebar__list .sheet-item__input",
  );
}

function tabLabel(): HTMLElement | null {
  return document.querySelector(".register-table-tabs .sheet-tab__label");
}

function tabLabelText(): string {
  return tabLabel()?.textContent ?? "";
}

/** 按名称查找侧边栏表项的名称 span（名称 = textContent）。 */
function sidebarItemName(name: string): HTMLElement | null {
  return (
    Array.from(
      document.querySelectorAll<HTMLElement>(
        ".sheet-sidebar__list .sheet-item__name",
      ),
    ).find((el) => el.textContent === name) ?? null
  );
}

beforeEach(() => {
  initI18n();
  useAppStore.setState({
    host: null,
    workspace: createEmptyWorkspace(),
    loaded: true,
    connectionState: "disconnected",
    activeSheetId: null,
  });
});

describe("Sheet 名重命名编辑态隔离", () => {
  it("页签头进入编辑态时，侧边栏对应项不渲染输入框", () => {
    render(<MamepApp />);
    expect(tabLabelText()).toBe("Sheet 1");

    fireEvent.doubleClick(tabLabel()!);

    expect(tabRenameInput()).toBeTruthy();
    expect(sidebarRenameInput()).toBeNull();
    // 侧边栏仍显示普通名称。
    expect(sidebarItemName("Sheet 1")).toBeTruthy();
  });

  it("页签头 Enter 提交后，名称在页签头与侧边栏同步更新", () => {
    render(<MamepApp />);

    fireEvent.doubleClick(tabLabel()!);
    const input = tabRenameInput()!;
    fireEvent.change(input, { target: { value: "Inverter A" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(tabRenameInput()).toBeNull();
    expect(tabLabelText()).toBe("Inverter A");
    expect(sidebarItemName("Inverter A")).toBeTruthy();
    expect(sidebarItemName("Sheet 1")).toBeNull();
  });

  it("页签头失焦提交重命名并同步到侧边栏", () => {
    render(<MamepApp />);

    fireEvent.doubleClick(tabLabel()!);
    const input = tabRenameInput()!;
    fireEvent.change(input, { target: { value: "After Blur" } });
    fireEvent.blur(input);

    expect(tabRenameInput()).toBeNull();
    expect(tabLabelText()).toBe("After Blur");
    expect(sidebarItemName("After Blur")).toBeTruthy();
  });

  it("页签头 Escape 取消编辑且不改变名称", () => {
    render(<MamepApp />);

    fireEvent.doubleClick(tabLabel()!);
    const input = tabRenameInput()!;
    fireEvent.change(input, { target: { value: "Not Applied" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(tabRenameInput()).toBeNull();
    expect(tabLabelText()).toBe("Sheet 1");
    expect(sidebarItemName("Not Applied")).toBeNull();
  });

  it("页签头输入框按 Backspace：不关闭标签、不退出编辑态", () => {
    render(<MamepApp />);

    fireEvent.doubleClick(tabLabel()!);
    const input = tabRenameInput()!;
    // 聚焦输入框后按 Backspace（携带 code，模拟真实键盘事件）。
    input.focus();
    fireEvent.keyDown(input, { key: "Backspace", code: "Backspace" });

    // 编辑态仍在，且未因冒泡到 Tabs 键盘删除逻辑而关闭标签。
    expect(tabRenameInput()).toBeTruthy();
    expect(
      document.querySelectorAll(".sheet-sidebar__list .sheet-item--closed")
        .length,
    ).toBe(0);
    expect(sidebarItemName("Sheet 1")).toBeTruthy();
  });
});
