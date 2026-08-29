/**
 * 快捷键守卫单测（PRD §8.3 P1，2026-08-30，ADR-037）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "@mamep2026/domain";
import { useAppStore } from "../app-store";
import {
  isAnyModalOpen,
  isArrowNavigationBlocked,
  isTextInputTarget,
} from "./guards";

function makeElement(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  const el = div.firstElementChild;
  if (el === null) throw new Error("empty html");
  return el as HTMLElement;
}

describe("isTextInputTarget", () => {
  it("文本类控件/下拉/可编辑单元格 wrap 视为文本输入（拦截快捷键）", () => {
    expect(isTextInputTarget(makeElement('<input type="text" />'))).toBe(true);
    expect(isTextInputTarget(makeElement("<input />"))).toBe(true);
    expect(isTextInputTarget(makeElement("<textarea />"))).toBe(true);
    expect(isTextInputTarget(makeElement("<select />"))).toBe(true);
    expect(
      isTextInputTarget(
        makeElement('<div class="register-table__editable-cell-value-wrap" />'),
      ),
    ).toBe(true);
    // 注：contenteditable 元素的 isContentEditable 在 jsdom 中不可靠（生产浏览器正常），
    // 此处不覆盖；该分支与既有 RegisterTable 守卫语义一致（isContentEditable）。
  });

  it("按钮/复选框/普通 div/null 不是文本输入", () => {
    expect(isTextInputTarget(makeElement("<button />"))).toBe(false);
    expect(isTextInputTarget(makeElement('<input type="checkbox" />'))).toBe(
      false,
    );
    expect(isTextInputTarget(makeElement("<div />"))).toBe(false);
    expect(isTextInputTarget(null)).toBe(false);
  });
});

describe("isArrowNavigationBlocked", () => {
  it("焦点在表格体外时阻止方向键导航", () => {
    expect(isArrowNavigationBlocked(makeElement("<div />"))).toBe(true);
    expect(isArrowNavigationBlocked(null)).toBe(true);
  });

  it("焦点在表格体内（按钮/复选框/可编辑 wrap）允许方向键导航", () => {
    const inTable = makeElement(
      '<div class="ant-table"><button /><input type="checkbox" /><div class="register-table__editable-cell-value-wrap" /></div>',
    );
    expect(isArrowNavigationBlocked(inTable.querySelector("button"))).toBe(
      false,
    );
    expect(
      isArrowNavigationBlocked(inTable.querySelector('input[type="checkbox"]')),
    ).toBe(false);
    expect(
      isArrowNavigationBlocked(
        inTable.querySelector(".register-table__editable-cell-value-wrap"),
      ),
    ).toBe(false);
  });

  it("焦点在表格内的文本输入/数字输入时阻止（避免与编辑冲突）", () => {
    const inTable = makeElement(
      '<div class="ant-table"><input type="text" /><input /></div>',
    );
    expect(
      isArrowNavigationBlocked(inTable.querySelector('input[type="text"]')),
    ).toBe(true);
    expect(
      isArrowNavigationBlocked(inTable.querySelector('input:not([type])')),
    ).toBe(true);
  });
});

describe("isAnyModalOpen", () => {
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

  it("无弹窗打开时返回 false", () => {
    expect(isAnyModalOpen()).toBe(false);
  });

  it("任一弹窗打开（含导入草稿/确认弹窗）时返回 true", () => {
    useAppStore.setState({ settingsModalOpen: true });
    expect(isAnyModalOpen()).toBe(true);
    useAppStore.setState({ settingsModalOpen: false, helpModalOpen: true });
    expect(isAnyModalOpen()).toBe(true);
    useAppStore.setState({
      helpModalOpen: false,
      workspaceImportDraft: {
        workspace: createEmptyWorkspace(),
        preview: {
          name: "x",
          sheets: 1,
          rows: 0,
          connections: 0,
          schemaVersion: 4,
        },
      },
    });
    expect(isAnyModalOpen()).toBe(true);
  });
});
