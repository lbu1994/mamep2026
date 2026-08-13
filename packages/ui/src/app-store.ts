/**
 * UI Store（zustand）：领域持久状态、运行时连接状态、通信任务投影与纯界面状态
 * 的分类视图（docs/TECH_DESIGN.md §4.4）。
 */
import type {
  DataType,
  RegisterRow,
  RowId,
  SheetId,
  Workspace,
} from "@mamep2026/domain";
import {
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
  duplicateRow,
  moveRow,
  renumberRows,
} from "@mamep2026/register-table";
import { create } from "zustand";
import type { AppHost } from "./host";

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
  theme: "light" | "dark";
  saveStatus: SaveStatus;
  messages: ApplicationMessage[];
  commLog: CommunicationLogEntry[];
  traceWindows: Record<string, TraceWindowModel>;
  pollingKeys: Record<string, string>;

  setHost: (host: AppHost) => void;
  setWorkspace: (workspace: Workspace) => void;
  setLoaded: () => void;
  setConnectionState: (state: ConnectionState) => void;
  setConnectionModalOpen: (open: boolean) => void;
  setPluginModalOpen: (open: boolean) => void;
  setSettingsModalOpen: (open: boolean) => void;
  setTheme: (theme: "light" | "dark") => void;
  setSaveStatus: (status: SaveStatus) => void;
  setActiveSheetId: (sheetId: SheetId) => void;

  updateRow: (rowId: RowId, updater: (row: RegisterRow) => RegisterRow) => void;
  commitRowAddress: (rowId: RowId, draft: string) => Result<RegisterRow>;
  addRow: (sheetId: SheetId) => void;
  deleteRow: (sheetId: SheetId, rowId: RowId) => void;
  moveRow: (sheetId: SheetId, rowId: RowId, direction: "up" | "down") => void;
  duplicateRowInSheet: (sheetId: SheetId, rowId: RowId) => void;
  addSheet: () => void;
  renameSheet: (sheetId: SheetId, name: string) => void;
  closeSheet: (sheetId: SheetId) => void;
  duplicateSheet: (sheetId: SheetId) => void;
  setRowDataType: (rowId: RowId, dataType: DataType) => void;

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
}

function currentSheet(
  state: AppStoreState,
): Workspace["sheets"][number] | undefined {
  const id = state.activeSheetId ?? state.workspace.activeSheetId;
  return state.workspace.sheets.find((sheet) => sheet.sheetId === id);
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
  theme: "light",
  saveStatus: "idle",
  messages: [],
  commLog: [],
  traceWindows: {},
  pollingKeys: {},

  setHost: (host) => set({ host }),
  setWorkspace: (workspace) => set({ workspace }),
  setLoaded: () => set({ loaded: true }),
  setConnectionState: (connectionState) => set({ connectionState }),
  setConnectionModalOpen: (connectionModalOpen) => set({ connectionModalOpen }),
  setPluginModalOpen: (pluginModalOpen) => set({ pluginModalOpen }),
  setSettingsModalOpen: (settingsModalOpen) => set({ settingsModalOpen }),
  setTheme: (theme) =>
    set((state) => ({
      theme,
      workspace: {
        ...state.workspace,
        preferences: { ...state.workspace.preferences, theme },
      },
    })),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setActiveSheetId: (activeSheetId) =>
    set((state) => ({
      activeSheetId,
      workspace: { ...state.workspace, activeSheetId },
    })),

  updateRow: (rowId, updater) =>
    set((state) => {
      const sheets = state.workspace.sheets.map((sheet) => {
        const index = sheet.rows.findIndex((row) => row.rowId === rowId);
        if (index === -1) return sheet;
        const rows = [...sheet.rows];
        const current = rows[index];
        if (current !== undefined) rows[index] = updater(current);
        return { ...sheet, rows, updatedAt: Date.now() };
      });
      return {
        workspace: { ...state.workspace, sheets, updatedAt: Date.now() },
      };
    }),

  commitRowAddress: (rowId, draft) => {
    const sheet = currentSheet(get());
    const row = sheet?.rows.find((r) => r.rowId === rowId);
    if (row === undefined) {
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
    const result = commitAddress(row, draft);
    if (result.ok) {
      get().updateRow(rowId, () => result.value);
    }
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

  duplicateSheet: (sheetId) =>
    set((state) => {
      const source = state.workspace.sheets.find(
        (sheet) => sheet.sheetId === sheetId,
      );
      if (source === undefined) return state;
      const order = state.workspace.sheets.length;
      const copy = createRegisterSheet(`${source.name} copy`, order);
      copy.rows = source.rows.map((row) => ({
        ...row,
        rowId: newRowId(),
        pollingEnabled: false,
        traceEnabled: false,
      }));
      return {
        workspace: {
          ...state.workspace,
          sheets: [...state.workspace.sheets, copy],
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

  openTraceWindow: (rowId) =>
    set((state) => ({
      traceWindows: {
        ...state.traceWindows,
        [rowId]: {
          rowId,
          bufferSize: "continue",
          speed: 60,
          playing: true,
          samples: [],
          average: null,
        },
      },
    })),
  closeTraceWindow: (rowId) =>
    set((state) => {
      const windows = { ...state.traceWindows };
      delete windows[rowId];
      return { traceWindows: windows };
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
}));
