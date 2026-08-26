/**
 * UI Store（zustand）：领域持久状态、运行时连接状态、通信任务投影与纯界面状态
 * 的分类视图（docs/TECH_DESIGN.md §4.4）。
 */
import type {
  DataType,
  PanelLayout,
  ReadVerifySettings,
  RegisterRadix,
  RegisterRow,
  RowId,
  SheetId,
  Workspace,
} from "@mamep2026/domain";
import {
  createDefaultRtuProfile,
  createDefaultTcpProfile,
  createEmptyRow,
  createEmptyWorkspace,
  createRegisterSheet,
  newRowId,
} from "@mamep2026/domain";
import type { ConnectionState } from "@mamep2026/communication";
import type {
  CommunicationLogEntry,
  ApplicationMessage,
} from "@mamep2026/logging";
import type { SaveStatus } from "@mamep2026/workspace";
import type { Result } from "@mamep2026/domain";
import {
  addRowAfter,
  commitAddress,
  commitCellText as commitCellTextUseCase,
  copyRowsToClipboard,
  cutRowsFromSheet,
  decodeClipboardCsv,
  deleteRows,
  duplicateRow,
  encodeClipboardCsv,
  insertRowBefore,
  moveRow,
  moveRowToIndex,
  moveRows,
  pasteClipboardRows,
  renumberRows,
  type ClipboardIssue,
  type RowClipboardData,
} from "@mamep2026/register-table";
import type { ThemeConfig } from "antd";
import { create } from "zustand";
import {
  applyCellCommit,
  applyCellValidation,
  applyManualResult,
  applyPollResultStatus,
  applyRowEdit,
  createEmptyRowStatusState,
  type ApplyManualResultOptions,
  type RowFailure,
  type RowSuccess,
  type RowSuccessKind,
} from "./row-result";
import type { AppHost } from "./host";
import {
  persistedSettingsSchema,
  type PersistedConnectionSettings,
} from "./components/connection-settings-model";
import { applyLanguage } from "./i18n";

export type BufferSizeOption =
  "continue" | "100" | "500" | "1000" | "1500" | "2000" | "3000";

export interface TraceWindowModel {
  rowId: string;
  bufferSize: BufferSizeOption;
  /** Speed 滑块 0..100（Quick -> Slow）。 */
  speed: number;
  playing: boolean;
  samples: Array<{ no: number; value: string }>;
  average: string | null;
}

export interface AppStoreState {
  host: AppHost | null;
  workspace: Workspace;
  loaded: boolean;
  connectionState: ConnectionState;
  activeSheetId: SheetId | null;
  connectionModalOpen: boolean;
  pluginModalOpen: boolean;
  settingsModalOpen: boolean;
  pendingDeleteSheetId: SheetId | null;
  /** 批量关闭（关闭其他/右侧）确认弹窗状态；null 表示未在确认。 */
  pendingBulkClose: { kind: "others" | "right"; sheetId: SheetId } | null;
  theme: "light" | "dark";
  /**
   * 宿主提供的完整 antd 主题（VSCode 完整令牌映射，ui-theme buildVscodeTheme 产出，ADR-027）；
   * null=回退 buildTheme 两态。运行时派生（随宿主主题事件更新），不持久化。
   */
  themeConfig: ThemeConfig | null;
  saveStatus: SaveStatus;
  messages: ApplicationMessage[];
  commLog: CommunicationLogEntry[];
  traceWindows: Record<string, TraceWindowModel>;
  pollingKeys: Record<string, string>;
  /** 行操作结果三态状态点（纯 UI 会话状态，不持久化，§19.2 同 selectedRowIds）。 */
  rowResults: Record<RowId, RowFailure | undefined>;
  rowDirty: Record<RowId, boolean>;
  rowSuccess: Record<RowId, RowSuccess | undefined>;
  /** Data/地址列编辑校验错误（纯 UI 会话状态，不持久化；键=`${rowId}:data|address`）。 */
  cellValidationErrors: Record<string, RowFailure | undefined>;

  setHost: (host: AppHost) => void;
  setWorkspace: (workspace: Workspace) => void;
  setLoaded: () => void;
  setConnectionState: (state: ConnectionState) => void;
  setConnectionModalOpen: (open: boolean) => void;
  setPluginModalOpen: (open: boolean) => void;
  setSettingsModalOpen: (open: boolean) => void;
  setPendingDeleteSheetId: (sheetId: SheetId | null) => void;
  setPendingBulkClose: (
    pendingBulkClose: { kind: "others" | "right"; sheetId: SheetId } | null,
  ) => void;
  setTheme: (theme: "light" | "dark") => void;
  /** 设置宿主完整主题（VSCode ui-theme；null=回退 buildTheme 两态）。运行时派生，不持久化。 */
  setThemeConfig: (themeConfig: ThemeConfig | null) => void;
  /** 记录界面语言选择到工作区偏好（随自动保存持久化；i18n 引擎切换由组件层调用）。 */
  setLanguage: (language: "en-US" | "zh-CN") => void;
  /** 更新活动连接配置的持久化设置（除串口/端口选择外的全部参数），随自动保存持久化。 */
  setConnectionSettings: (settings: PersistedConnectionSettings) => void;
  setSaveStatus: (status: SaveStatus) => void;
  setActiveSheetId: (sheetId: SheetId) => void;
  /** 更新工作区面板布局（侧栏/底部面板折叠、高度、活动 tab），随自动保存持久化。 */
  setPanelLayout: (partial: Partial<PanelLayout>) => void;

  updateRow: (rowId: RowId, updater: (row: RegisterRow) => RegisterRow) => void;
  commitRowAddress: (rowId: RowId, draft: string) => Result<RegisterRow>;
  /** 提交 Data 单元格文本：按 Type 校验；失败保留输入并记录校验错误（§17/§23）。 */
  commitCellText: (rowId: RowId, text: string) => Result<RegisterRow>;
  addRow: (sheetId: SheetId) => void;
  deleteRow: (sheetId: SheetId, rowId: RowId) => void;
  moveRow: (sheetId: SheetId, rowId: RowId, direction: "up" | "down") => void;
  /** dnd-kit 拖拽排序：把行移动到目标索引（arrayMove 语义，越界钳制）。 */
  moveRowToIndex: (sheetId: SheetId, rowId: RowId, targetIndex: number) => void;
  duplicateRowInSheet: (sheetId: SheetId, rowId: RowId) => void;
  /** 行多选与剪贴板：会话状态，不随工作区持久化（§19.2）。 */
  selectedRowIds: RowId[];
  clipboardPayload: RowClipboardData[] | null;
  setSelectedRowIds: (rowIds: RowId[]) => void;
  insertRowAfter: (sheetId: SheetId, rowId: RowId) => void;
  insertRowBefore: (sheetId: SheetId, rowId: RowId) => void;
  moveSelectedRows: (sheetId: SheetId, direction: "up" | "down") => void;
  deleteSelectedRows: (sheetId: SheetId) => void;
  copySelectedRows: (sheetId: SheetId) => void;
  cutSelectedRows: (sheetId: SheetId) => void;
  /** 粘贴到 afterRowId 之后；afterRowId 为 null 时追加到表尾。 */
  pasteRows: (sheetId: SheetId, afterRowId: RowId | null) => Promise<void>;
  addSheet: () => void;
  renameSheet: (sheetId: SheetId, name: string) => void;
  /** 关闭一张表（非破坏性）：表仍保留在工作区（侧边栏可见），仅从页签栏隐藏。 */
  closeSheet: (sheetId: SheetId) => void;
  /** 打开一张已关闭的表并设为活动表（侧边栏点击）。 */
  openSheet: (sheetId: SheetId) => void;
  /** 真正删除一张表（破坏性）：从工作区移除；删除唯一表后重建默认空表。 */
  deleteSheet: (sheetId: SheetId) => void;
  /** 关闭除目标表外的所有表（非破坏性）；目标表保留并成为活动表。 */
  closeOtherSheets: (sheetId: SheetId) => void;
  /** 关闭目标表右侧的所有表（非破坏性）；目标表保留并成为活动表。 */
  closeSheetsToRight: (sheetId: SheetId) => void;
  duplicateSheet: (sheetId: SheetId) => void;
  moveSheetTo: (sheetId: SheetId, toIndex: number) => void;
  setRowDataType: (rowId: RowId, dataType: DataType) => void;
  /** 设置某张表的 Register 地址列进制（DEC/HEX），随自动保存持久化（ADR-014）。 */
  setSheetRegisterRadix: (sheetId: SheetId, radix: RegisterRadix) => void;
  /** 设置某张表的 Slave Address（每表独立，随表持久化，IndexedDB 自动保存，2026-08-19）。 */
  setSheetSlaveAddress: (sheetId: SheetId, slave: number) => void;
  /** 设置某张表的写后回读配置（每表独立，随表持久化，2026-08-26）。 */
  setSheetWriteVerify: (
    sheetId: SheetId,
    settings: ReadVerifySettings,
  ) => void;
  /** 设置某张表的列宽（每表独立，随表持久化，IndexedDB 自动保存）。 */
  setSheetColumnWidths: (
    sheetId: SheetId,
    widths: Record<string, number>,
  ) => void;
  /** 设置某张表的列排列顺序（每表独立，随表持久化；null=恢复默认顺序）。 */
  setSheetColumnOrder: (sheetId: SheetId, order: string[] | null) => void;

  openTraceWindow: (rowId: RowId) => void;
  closeTraceWindow: (rowId: RowId) => void;
  setTracePlaying: (rowId: RowId, playing: boolean) => void;
  setTraceBufferSize: (rowId: RowId, bufferSize: BufferSizeOption) => void;
  setTraceSpeed: (rowId: RowId, speed: number) => void;
  appendTraceSample: (
    rowId: RowId,
    sample: { no: number; value: string },
  ) => void;
  setTraceAverage: (rowId: RowId, average: string | null) => void;

  appendMessage: (message: ApplicationMessage) => void;
  appendCommLog: (entry: CommunicationLogEntry) => void;
  clearCommLog: () => void;
  setNotes: (notes: string) => void;

  /** 手动读/写结果：更新失败态与成功点（成功点仅手动操作触发，§row-result）。 */
  recordManualResult: (
    rowId: RowId,
    result: Result<unknown>,
    kind: RowSuccessKind,
    options?: ApplyManualResultOptions,
  ) => void;
  /** 轮询/全表读取逐行结果：成功清失败/编辑完成态；失败幂等写失败态（不产生成功点）。 */
  recordPollResult: (rowId: RowId, result: Result<unknown>) => void;
  /** Data 编辑提交：对比编辑前后值设置/清除编辑完成态；编辑覆盖成功态。 */
  recordRowEdit: (rowId: RowId, before: string, after: string) => void;
}

export const useAppStore = create<AppStoreState>()((set, get) => ({
  host: null,
  workspace: createEmptyWorkspace(),
  loaded: false,
  connectionState: "disconnected",
  activeSheetId: null,
  connectionModalOpen: false,
  pluginModalOpen: false,
  settingsModalOpen: false,
  pendingDeleteSheetId: null,
  pendingBulkClose: null,
  theme: "light",
  themeConfig: null,
  saveStatus: "idle",
  messages: [],
  commLog: [],
  traceWindows: {},
  pollingKeys: {},
  selectedRowIds: [],
  clipboardPayload: null,
  ...createEmptyRowStatusState(),

  setHost: (host) => set({ host }),
  setWorkspace: (workspace) => {
    // 加载/重置工作区时恢复持久化的语言偏好（刷新后保持上次选择）。
    applyLanguage(workspace.preferences.language);
    return set((state) => ({
      workspace,
      // 加载工作区时回填持久化的主题，避免刷新后恒为浅色。
      theme: workspace.preferences.theme ?? state.theme,
    }));
  },
  setLoaded: () => set({ loaded: true }),
  setConnectionState: (connectionState) => set({ connectionState }),
  setConnectionModalOpen: (connectionModalOpen) => set({ connectionModalOpen }),
  setPluginModalOpen: (pluginModalOpen) => set({ pluginModalOpen }),
  setSettingsModalOpen: (settingsModalOpen) => set({ settingsModalOpen }),
  setPendingDeleteSheetId: (pendingDeleteSheetId) =>
    set({ pendingDeleteSheetId }),
  setPendingBulkClose: (pendingBulkClose) => set({ pendingBulkClose }),
  setTheme: (theme) =>
    set((state) => ({
      theme,
      workspace: {
        ...state.workspace,
        preferences: { ...state.workspace.preferences, theme },
      },
    })),
  setThemeConfig: (themeConfig) => set({ themeConfig }),
  setLanguage: (language) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        preferences: { ...state.workspace.preferences, language },
        updatedAt: Date.now(),
      },
    })),
  setConnectionSettings: (settings) =>
    set((state) => {
      const current = state.workspace.connectionProfiles[0];
      if (current === undefined) return {};
      // 防御性校验：InputNumber 临时越界（如输入 999）时拒绝写入，避免污染持久化数据。
      const validated = persistedSettingsSchema.safeParse(settings);
      if (!validated.success) return {};
      const next = validated.data;
      // 按协议重建 profile（保留 id）：切换协议时从默认值 + 持久化子集构建。
      const merged =
        next.protocol === "rtu"
          ? { ...createDefaultRtuProfile(), ...next, id: current.id }
          : { ...createDefaultTcpProfile(), ...next, id: current.id };
      const connectionProfiles = [
        merged,
        ...state.workspace.connectionProfiles.slice(1),
      ];
      return {
        workspace: {
          ...state.workspace,
          connectionProfiles,
          updatedAt: Date.now(),
        },
      };
    }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setActiveSheetId: (activeSheetId) =>
    set((state) => ({
      activeSheetId,
      workspace: { ...state.workspace, activeSheetId },
    })),

  setPanelLayout: (partial) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        panelLayout: { ...state.workspace.panelLayout, ...partial },
        updatedAt: Date.now(),
      },
    })),

  updateRow: (rowId, updater) =>
    set((state) => {
      // 外科手术式更新（性能优化）：只重建包含目标行的 sheet 及其 rows 数组，
      // 其余 sheet 对象与 rows 引用保持不变，避免单行变化（击键/WP 轮询结果）
      // 引发非活动表乃至全应用重渲染。找不到目标行时不产生状态变更。
      const sheetIndex = state.workspace.sheets.findIndex((sheet) =>
        sheet.rows.some((row) => row.rowId === rowId),
      );
      if (sheetIndex === -1) return {};
      const sheet = state.workspace.sheets[sheetIndex];
      if (sheet === undefined) return {};
      const rowIndex = sheet.rows.findIndex((row) => row.rowId === rowId);
      if (rowIndex === -1) return {};
      const current = sheet.rows[rowIndex];
      if (current === undefined) return {};
      const next = updater(current);
      // 性能优化：updater 返回原行引用表示无实际变化（如轮询值未变时 applyPollResult
      // 短路返回原行），直接返回空变更——不重建 rows/sheet/workspace，从而切断
      // 级联重渲染、自动保存与轮询目标重建的整条链路。
      if (next === current) return {};
      const rows = [...sheet.rows];
      rows[rowIndex] = next;
      const sheets = [...state.workspace.sheets];
      sheets[sheetIndex] = { ...sheet, rows, updatedAt: Date.now() };
      return {
        workspace: { ...state.workspace, sheets, updatedAt: Date.now() },
      };
    }),

  commitRowAddress: (rowId, draft) => {
    // 按 rowId 在全部表中定位所属表，取该表的地址进制（每表独立，ADR-014）。
    const sheets = get().workspace.sheets;
    const sheet = sheets.find((s) => s.rows.some((r) => r.rowId === rowId));
    const row = sheet?.rows.find((r) => r.rowId === rowId);
    if (row === undefined || sheet === undefined) {
      return {
        ok: false as const,
        error: {
          code: "ROW_NOT_FOUND",
          category: "validation" as const,
          severity: "error" as const,
          retryable: false,
          userMessageKey: "errors.rowNotFound",
          technicalMessage: "row not found",
        },
      };
    }
    const result = commitAddress(row, draft, sheet.registerRadix);
    // §23 校验失败保留用户输入：draft 回写；成功时由 result.value 更新（归一化后的 draft）。
    get().updateRow(rowId, (r) =>
      result.ok
        ? result.value
        : { ...r, addressDraft: draft, updatedAt: Date.now() },
    );
    // 地址校验错误状态：失败记录（红框+Tooltip）、成功清除；不触碰三态状态点。
    set((state) => {
      const next = applyCellValidation(
        {
          rowResults: state.rowResults,
          rowDirty: state.rowDirty,
          rowSuccess: state.rowSuccess,
          cellValidationErrors: state.cellValidationErrors,
        },
        rowId,
        result,
      );
      return {
        rowResults: next.rowResults,
        rowDirty: next.rowDirty,
        rowSuccess: next.rowSuccess,
        cellValidationErrors: next.cellValidationErrors,
      };
    });
    return result;
  },

  commitCellText: (rowId, text) => {
    const sheets = get().workspace.sheets;
    const sheet = sheets.find((s) => s.rows.some((r) => r.rowId === rowId));
    const row = sheet?.rows.find((r) => r.rowId === rowId);
    if (row === undefined || sheet === undefined) {
      return {
        ok: false as const,
        error: {
          code: "ROW_NOT_FOUND",
          category: "validation" as const,
          severity: "error" as const,
          retryable: false,
          userMessageKey: "errors.rowNotFound",
          technicalMessage: "row not found",
        },
      };
    }
    const result = commitCellTextUseCase(row, text);
    // §23 校验失败保留用户输入：cellText 回写；成功时由 result.value 更新（原引用短路零更新）。
    get().updateRow(rowId, (r) =>
      result.ok
        ? result.value
        : { ...r, cellText: text, updatedAt: Date.now() },
    );
    // 校验结果 → 行状态：成功清校验错误并置编辑完成态；失败记录校验错误、清设备失败/成功态。
    set((state) => {
      const next = applyCellCommit(
        {
          rowResults: state.rowResults,
          rowDirty: state.rowDirty,
          rowSuccess: state.rowSuccess,
          cellValidationErrors: state.cellValidationErrors,
        },
        rowId,
        row.cellText,
        text,
        result,
      );
      return {
        rowResults: next.rowResults,
        rowDirty: next.rowDirty,
        rowSuccess: next.rowSuccess,
        cellValidationErrors: next.cellValidationErrors,
      };
    });
    return result;
  },

  addRow: (sheetId) =>
    set((state) => {
      const sheets = state.workspace.sheets.map((sheet) => {
        if (sheet.sheetId !== sheetId) return sheet;
        const last = sheet.rows[sheet.rows.length - 1];
        if (last === undefined) {
          return {
            ...sheet,
            rows: renumberRows([createEmptyRow()]),
            updatedAt: Date.now(),
          };
        }
        return addRowAfter(sheet, last.rowId);
      });
      return {
        workspace: { ...state.workspace, sheets, updatedAt: Date.now() },
      };
    }),

  deleteRow: (sheetId, rowId) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId
            ? {
                ...sheet,
                rows: renumberRows(sheet.rows.filter((r) => r.rowId !== rowId)),
                updatedAt: Date.now(),
              }
            : sheet,
        ),
        updatedAt: Date.now(),
      },
    })),

  moveRow: (sheetId, rowId, direction) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId ? moveRow(sheet, rowId, direction) : sheet,
        ),
        updatedAt: Date.now(),
      },
    })),

  moveRowToIndex: (sheetId, rowId, targetIndex) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId
            ? moveRowToIndex(sheet, rowId, targetIndex)
            : sheet,
        ),
        updatedAt: Date.now(),
      },
    })),

  duplicateRowInSheet: (sheetId, rowId) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId ? duplicateRow(sheet, rowId) : sheet,
        ),
        updatedAt: Date.now(),
      },
    })),

  setSelectedRowIds: (rowIds) => set({ selectedRowIds: rowIds }),

  insertRowAfter: (sheetId, rowId) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId ? addRowAfter(sheet, rowId) : sheet,
        ),
        updatedAt: Date.now(),
      },
    })),

  insertRowBefore: (sheetId, rowId) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId ? insertRowBefore(sheet, rowId) : sheet,
        ),
        updatedAt: Date.now(),
      },
    })),

  moveSelectedRows: (sheetId, direction) =>
    set((state) => {
      const sheet = state.workspace.sheets.find((s) => s.sheetId === sheetId);
      if (sheet === undefined || state.selectedRowIds.length === 0) {
        return state;
      }
      const updated = moveRows(sheet, state.selectedRowIds, direction);
      return {
        workspace: {
          ...state.workspace,
          sheets: state.workspace.sheets.map((s) =>
            s.sheetId === sheetId ? updated : s,
          ),
          updatedAt: Date.now(),
        },
      };
    }),

  deleteSelectedRows: (sheetId) =>
    set((state) => {
      const sheet = state.workspace.sheets.find((s) => s.sheetId === sheetId);
      if (sheet === undefined || state.selectedRowIds.length === 0) {
        return state;
      }
      const updated = deleteRows(sheet, state.selectedRowIds);
      return {
        workspace: {
          ...state.workspace,
          sheets: state.workspace.sheets.map((s) =>
            s.sheetId === sheetId ? updated : s,
          ),
          updatedAt: Date.now(),
        },
        selectedRowIds: [],
      };
    }),

  copySelectedRows: (sheetId) => {
    const state = get();
    const sheet = state.workspace.sheets.find((s) => s.sheetId === sheetId);
    if (sheet === undefined || state.selectedRowIds.length === 0) return;
    const payload = copyRowsToClipboard(sheet, state.selectedRowIds);
    set({ clipboardPayload: payload });
    const host = state.host;
    if (host !== null) {
      void host
        .copyTextToClipboard(encodeClipboardCsv(payload))
        .then((result) => {
          if (!result.ok) {
            get().appendMessage({
              timestamp: Date.now(),
              level: "warning",
              messageKey: "messages.clipboardWriteFailed",
              params: { detail: result.error.code },
              detail: result.error.code,
            });
          }
        });
    }
  },

  cutSelectedRows: (sheetId) => {
    const state = get();
    const sheet = state.workspace.sheets.find((s) => s.sheetId === sheetId);
    if (sheet === undefined || state.selectedRowIds.length === 0) return;
    const { sheet: updated, payload } = cutRowsFromSheet(
      sheet,
      state.selectedRowIds,
    );
    set({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((s) =>
          s.sheetId === sheetId ? updated : s,
        ),
        updatedAt: Date.now(),
      },
      clipboardPayload: payload,
      selectedRowIds: [],
    });
    const host = state.host;
    if (host !== null) {
      void host
        .copyTextToClipboard(encodeClipboardCsv(payload))
        .then((result) => {
          if (!result.ok) {
            get().appendMessage({
              timestamp: Date.now(),
              level: "warning",
              messageKey: "messages.clipboardWriteFailed",
              params: { detail: result.error.code },
              detail: result.error.code,
            });
          }
        });
    }
  },

  pasteRows: async (sheetId, afterRowId) => {
    const state = get();
    const sheet = state.workspace.sheets.find((s) => s.sheetId === sheetId);
    if (sheet === undefined) return;
    let payload: RowClipboardData[] | null = null;
    let issues: ClipboardIssue[] = [];
    const host = state.host;
    // 系统剪贴板为优先来源；读取失败/无内容时回退到应用内剪贴板。
    if (host !== null) {
      const readResult = await host.readTextFromClipboard();
      if (readResult.ok && readResult.value !== null) {
        const decoded = decodeClipboardCsv(readResult.value);
        payload = decoded.rows;
        issues = decoded.issues;
      }
    }
    if (payload === null || payload.length === 0) {
      payload = state.clipboardPayload;
    }
    if (payload === null || payload.length === 0) return;
    const last = sheet.rows[sheet.rows.length - 1];
    const targetId = afterRowId ?? last?.rowId ?? "";
    const { sheet: updated, issues: pasteIssues } = pasteClipboardRows(
      sheet,
      targetId,
      payload,
      sheet.registerRadix,
    );
    const allIssues = [...issues, ...pasteIssues];
    set({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((s) =>
          s.sheetId === sheetId ? updated : s,
        ),
        updatedAt: Date.now(),
      },
    });
    if (allIssues.length > 0) {
      get().appendMessage({
        timestamp: Date.now(),
        level: "warning",
        messageKey: "messages.pasteIssues",
        params: { count: allIssues.length },
        detail: null,
      });
    }
  },

  addSheet: () =>
    set((state) => {
      const order = state.workspace.sheets.length;
      const sheet = createRegisterSheet(`Sheet ${order + 1}`, order);
      return {
        workspace: {
          ...state.workspace,
          sheets: [...state.workspace.sheets, sheet],
          activeSheetId: sheet.sheetId,
          updatedAt: Date.now(),
        },
        activeSheetId: sheet.sheetId,
      };
    }),

  renameSheet: (sheetId, name) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId ? { ...sheet, name } : sheet,
        ),
        updatedAt: Date.now(),
      },
    })),

  closeSheet: (sheetId) =>
    set((state) => {
      const target = state.workspace.sheets.find(
        (sheet) => sheet.sheetId === sheetId,
      );
      // 目标不存在或已处于关闭状态：无副作用。
      if (target === undefined || target.open === false) {
        return state;
      }
      const sheets = state.workspace.sheets.map((sheet) =>
        sheet.sheetId === sheetId
          ? { ...sheet, open: false, updatedAt: Date.now() }
          : sheet,
      );
      // 若关闭的是当前活动表，激活下一个仍打开的表；全部关闭时置空。
      const currentActive =
        state.activeSheetId ?? state.workspace.activeSheetId;
      const nextActive =
        currentActive === sheetId
          ? (sheets.find((sheet) => sheet.open)?.sheetId ?? null)
          : currentActive;
      return {
        workspace: {
          ...state.workspace,
          sheets,
          activeSheetId: nextActive,
          updatedAt: Date.now(),
        },
        activeSheetId: nextActive,
      };
    }),

  openSheet: (sheetId) =>
    set((state) => {
      const target = state.workspace.sheets.find(
        (sheet) => sheet.sheetId === sheetId,
      );
      if (target === undefined) return state;
      // 已打开的表：仅切换为活动表（与 setActiveSheetId 一致，不触发自动保存）。
      if (target.open) {
        return {
          activeSheetId: sheetId,
          workspace: { ...state.workspace, activeSheetId: sheetId },
        };
      }
      const sheets = state.workspace.sheets.map((sheet) =>
        sheet.sheetId === sheetId
          ? { ...sheet, open: true, updatedAt: Date.now() }
          : sheet,
      );
      return {
        workspace: {
          ...state.workspace,
          sheets,
          activeSheetId: sheetId,
          updatedAt: Date.now(),
        },
        activeSheetId: sheetId,
      };
    }),

  deleteSheet: (sheetId) =>
    set((state) => {
      const remaining = state.workspace.sheets.filter(
        (sheet) => sheet.sheetId !== sheetId,
      );
      const sheets =
        remaining.length === 0
          ? [createRegisterSheet("Sheet 1", 0)]
          : remaining;
      const nextActive =
        state.activeSheetId === sheetId ||
        sheets.every((s) => s.sheetId !== state.activeSheetId)
          ? (sheets[0]?.sheetId ?? null)
          : state.activeSheetId;
      return {
        workspace: {
          ...state.workspace,
          sheets,
          activeSheetId: nextActive,
          updatedAt: Date.now(),
        },
        activeSheetId: nextActive,
      };
    }),

  closeOtherSheets: (sheetId) =>
    set((state) => {
      const target = state.workspace.sheets.find(
        (sheet) => sheet.sheetId === sheetId,
      );
      // 目标不存在或已是唯一表：无副作用（不触发保存/轮询同步）。
      if (target === undefined || state.workspace.sheets.length <= 1) {
        return state;
      }
      const sheets = state.workspace.sheets.map((sheet) =>
        sheet.sheetId === sheetId
          ? { ...sheet, open: true }
          : { ...sheet, open: false },
      );
      return {
        workspace: {
          ...state.workspace,
          sheets,
          activeSheetId: sheetId,
          updatedAt: Date.now(),
        },
        activeSheetId: sheetId,
      };
    }),

  closeSheetsToRight: (sheetId) =>
    set((state) => {
      const index = state.workspace.sheets.findIndex(
        (sheet) => sheet.sheetId === sheetId,
      );
      // 目标不存在或已是末位表：无副作用。
      if (index === -1 || index === state.workspace.sheets.length - 1) {
        return state;
      }
      const sheets = state.workspace.sheets.map((sheet, i) =>
        i > index ? { ...sheet, open: false } : sheet,
      );
      return {
        workspace: {
          ...state.workspace,
          sheets,
          activeSheetId: sheetId,
          updatedAt: Date.now(),
        },
        activeSheetId: sheetId,
      };
    }),

  duplicateSheet: (sheetId) =>
    set((state) => {
      const sourceIndex = state.workspace.sheets.findIndex(
        (sheet) => sheet.sheetId === sheetId,
      );
      const source = state.workspace.sheets[sourceIndex];
      if (source === undefined) return state;
      const copy = createRegisterSheet(`${source.name} Copy`, sourceIndex + 1);
      // 副本继承源表的 Register 地址进制、列宽与列顺序（结构偏好随复制保留）。
      copy.registerRadix = source.registerRadix;
      copy.columnWidths = { ...source.columnWidths };
      copy.columnOrder =
        source.columnOrder === null ? null : [...source.columnOrder];
      copy.rows = source.rows.map((row) => ({
        ...row,
        rowId: newRowId(),
        pollingEnabled: false,
        traceEnabled: false,
      }));
      const sheets = [...state.workspace.sheets];
      sheets.splice(sourceIndex + 1, 0, copy);
      const reordered = sheets.map((sheet, index) => ({
        ...sheet,
        order: index,
      }));
      return {
        workspace: {
          ...state.workspace,
          sheets: reordered,
          activeSheetId: copy.sheetId,
          updatedAt: Date.now(),
        },
        activeSheetId: copy.sheetId,
      };
    }),

  moveSheetTo: (sheetId, toIndex) =>
    set((state) => {
      const fromIndex = state.workspace.sheets.findIndex(
        (sheet) => sheet.sheetId === sheetId,
      );
      if (fromIndex === -1 || fromIndex === toIndex) return state;
      const sheets = [...state.workspace.sheets];
      const [moved] = sheets.splice(fromIndex, 1);
      if (moved === undefined) return state;
      const clamp = Math.max(0, Math.min(toIndex, sheets.length));
      sheets.splice(clamp, 0, moved);
      const reordered = sheets.map((sheet, index) => ({
        ...sheet,
        order: index,
      }));
      return {
        workspace: {
          ...state.workspace,
          sheets: reordered,
          updatedAt: Date.now(),
        },
      };
    }),

  setRowDataType: (rowId, dataType) =>
    get().updateRow(rowId, (row) => ({
      ...row,
      dataType,
      updatedAt: Date.now(),
    })),

  setSheetRegisterRadix: (sheetId, radix) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId
            ? { ...sheet, registerRadix: radix, updatedAt: Date.now() }
            : sheet,
        ),
        updatedAt: Date.now(),
      },
    })),

  setSheetSlaveAddress: (sheetId, slave) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId
            ? { ...sheet, slaveAddress: slave, updatedAt: Date.now() }
            : sheet,
        ),
        updatedAt: Date.now(),
      },
    })),

  setSheetWriteVerify: (sheetId, settings) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId
            ? { ...sheet, writeVerify: settings, updatedAt: Date.now() }
            : sheet,
        ),
        updatedAt: Date.now(),
      },
    })),

  setSheetColumnWidths: (sheetId, widths) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId
            ? { ...sheet, columnWidths: widths, updatedAt: Date.now() }
            : sheet,
        ),
        updatedAt: Date.now(),
      },
    })),

  setSheetColumnOrder: (sheetId, order) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId
            ? { ...sheet, columnOrder: order, updatedAt: Date.now() }
            : sheet,
        ),
        updatedAt: Date.now(),
      },
    })),

  openTraceWindow: (rowId) =>
    set((state) => ({
      traceWindows: {
        ...state.traceWindows,
        [rowId]: {
          rowId,
          bufferSize: "continue",
          speed: 60,
          // 打开窗口不自动开始采样，等待用户手动点击 Play。
          playing: false,
          samples: [],
          average: null,
        },
      },
    })),
  closeTraceWindow: (rowId) =>
    set((state) => {
      const windows = { ...state.traceWindows };
      delete windows[rowId];
      // 关闭窗口后同步复位对应行的 TM 勾选（traceEnabled），保持 Checkbox 与窗口单向同步。
      let found = false;
      const sheets = state.workspace.sheets.map((sheet) => {
        let changed = false;
        const rows = sheet.rows.map((row) => {
          if (row.rowId !== rowId) return row;
          found = true;
          changed = true;
          return { ...row, traceEnabled: false, updatedAt: Date.now() };
        });
        return changed ? { ...sheet, rows, updatedAt: Date.now() } : sheet;
      });
      if (!found) return { traceWindows: windows };
      return {
        traceWindows: windows,
        workspace: {
          ...state.workspace,
          sheets,
          updatedAt: Date.now(),
        },
      };
    }),
  setTracePlaying: (rowId, playing) =>
    set((state) => {
      const current = state.traceWindows[rowId];
      if (current === undefined) return state;
      return {
        traceWindows: {
          ...state.traceWindows,
          [rowId]: { ...current, playing },
        },
      };
    }),
  setTraceBufferSize: (rowId, bufferSize) =>
    set((state) => {
      const current = state.traceWindows[rowId];
      if (current === undefined) return state;
      return {
        traceWindows: {
          ...state.traceWindows,
          [rowId]: { ...current, bufferSize },
        },
      };
    }),
  setTraceSpeed: (rowId, speed) =>
    set((state) => {
      const current = state.traceWindows[rowId];
      if (current === undefined) return state;
      return {
        traceWindows: { ...state.traceWindows, [rowId]: { ...current, speed } },
      };
    }),
  appendTraceSample: (rowId, sample) =>
    set((state) => {
      const current = state.traceWindows[rowId];
      if (current === undefined) return state;
      const samples = [...current.samples, sample];
      const cap =
        current.bufferSize === "continue" ? 10000 : Number(current.bufferSize);
      return {
        traceWindows: {
          ...state.traceWindows,
          [rowId]: {
            ...current,
            samples:
              samples.length > cap
                ? samples.slice(samples.length - cap)
                : samples,
          },
        },
      };
    }),
  setTraceAverage: (rowId, average) =>
    set((state) => {
      const current = state.traceWindows[rowId];
      if (current === undefined) return state;
      return {
        traceWindows: {
          ...state.traceWindows,
          [rowId]: { ...current, average },
        },
      };
    }),

  appendMessage: (message) =>
    set((state) => {
      const messages = [...state.messages, message];
      return {
        messages:
          messages.length > 2000
            ? messages.slice(messages.length - 2000)
            : messages,
      };
    }),
  appendCommLog: (entry) =>
    set((state) => {
      const commLog = [...state.commLog, entry];
      return {
        commLog:
          commLog.length > 10000
            ? commLog.slice(commLog.length - 10000)
            : commLog,
      };
    }),
  clearCommLog: () => set({ commLog: [] }),
  setNotes: (notes) =>
    set((state) => ({
      workspace: { ...state.workspace, notes, updatedAt: Date.now() },
    })),

  recordManualResult: (rowId, result, kind, options) =>
    set((state) => {
      const next = applyManualResult(
        {
          rowResults: state.rowResults,
          rowDirty: state.rowDirty,
          rowSuccess: state.rowSuccess,
          cellValidationErrors: state.cellValidationErrors,
        },
        rowId,
        result,
        kind,
        options,
      );
      if (
        next.rowResults === state.rowResults &&
        next.rowDirty === state.rowDirty &&
        next.rowSuccess === state.rowSuccess
      ) {
        return state;
      }
      return {
        rowResults: next.rowResults,
        rowDirty: next.rowDirty,
        rowSuccess: next.rowSuccess,
      };
    }),
  recordPollResult: (rowId, result) =>
    set((state) => {
      const next = applyPollResultStatus(
        {
          rowResults: state.rowResults,
          rowDirty: state.rowDirty,
          rowSuccess: state.rowSuccess,
          cellValidationErrors: state.cellValidationErrors,
        },
        rowId,
        result,
      );
      if (
        next.rowResults === state.rowResults &&
        next.rowDirty === state.rowDirty &&
        next.rowSuccess === state.rowSuccess
      ) {
        return state;
      }
      return {
        rowResults: next.rowResults,
        rowDirty: next.rowDirty,
        rowSuccess: next.rowSuccess,
      };
    }),
  recordRowEdit: (rowId, before, after) =>
    set((state) => {
      const next = applyRowEdit(
        {
          rowResults: state.rowResults,
          rowDirty: state.rowDirty,
          rowSuccess: state.rowSuccess,
          cellValidationErrors: state.cellValidationErrors,
        },
        rowId,
        before,
        after,
      );
      if (
        next.rowResults === state.rowResults &&
        next.rowDirty === state.rowDirty &&
        next.rowSuccess === state.rowSuccess
      ) {
        return state;
      }
      return {
        rowResults: next.rowResults,
        rowDirty: next.rowDirty,
        rowSuccess: next.rowSuccess,
      };
    }),
}));
