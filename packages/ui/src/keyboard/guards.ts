/**
 * 快捷键守卫（PRD §8.3 P1，2026-08-30，ADR-037）。
 * app 级（useGlobalShortcuts）与表格级（RegisterTable.handleGlobalKeyDown）共用，
 * 保证「焦点在输入控件不触发 / 弹窗打开不触发」的语义全应用一致。
 */
import { useAppStore } from "../app-store";

/**
 * 文本输入控件守卫：焦点在这些控件内时不拦截快捷键，避免与单元格编辑/下拉/备注等冲突。
 * 从 RegisterTable.handleGlobalKeyDown 的既有守卫抽取（selector 语义不变）。
 */
export function isTextInputTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest(
        "input[type='text'], input:not([type]), textarea, select, .ant-select, .register-table__editable-cell-value-wrap",
      ) !== null)
  );
}

/**
 * 方向键行导航专用守卫：仅当焦点在表格体内、且不在「真正编辑文本」的控件内时允许
 * 用 ↑/↓ 移动选中行。与 isTextInputTarget 的区别：
 * - 单元格可编辑 wrap（.register-table__editable-cell-value-wrap，非编辑态 role="button"）
 *   允许导航（不拦截方向键），但拦截 Delete/Ctrl+C 等（isTextInputTarget 语义不变）；
 * - 工具栏控件（Segmented/InputNumber 等）不在 .ant-table 内，方向键不被劫持。
 */
export function isArrowNavigationBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (target.closest(".ant-table") === null) return true;
  return (
    target.isContentEditable ||
    target.closest(
      "input[type='text'], input:not([type]), input[type='number'], textarea, select, .ant-select",
    ) !== null
  );
}

/**
 * 弹窗打开时抑制快捷键（app 级与表格级共用）：
 * 避免 Ctrl+Enter 与连接表单提交、Delete 与弹窗内控件交互等冲突。
 */
export function isAnyModalOpen(): boolean {
  const s = useAppStore.getState();
  return (
    s.connectionModalOpen ||
    s.settingsModalOpen ||
    s.helpModalOpen ||
    s.workspaceImportDraft !== null ||
    s.pendingDeleteSheetId !== null ||
    s.pendingBulkClose !== null
  );
}
