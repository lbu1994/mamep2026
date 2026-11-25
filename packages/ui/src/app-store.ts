/**
 * UI Store（zustand）：领域持久状态、运行时连接状态、通信任务投影与纯界面状态
 * 的分类视图（docs/TECH_DESIGN.md §4.4）。
 */
import type {
  AddressTransformConfig,
  DataType,
  PanelLayout,
  ReadVerifySettings,
  RegisterRadix,
  RegisterRow,
  RegisterSheet,
  RowId,
  SheetId,
  SheetType,
  Workspace,
  WorkspaceRecoveryInfo,
} from "@mamep2026/domain";
import {
  isCoreSheetType,
  createDefaultRtuProfile,
  createDefaultTcpProfile,
  createEmptyRow,
  createRegisterSheet,
  newRowId,
} from "@mamep2026/domain";
import type { ConnectionState } from "@mamep2026/communication";
import type { SerialDeviceHandle } from "@mamep2026/platform-api";
import type {
  CommunicationLogEntry,
  ApplicationMessage,
} from "@mamep2026/logging";
import type { SaveStatus } from "@mamep2026/workspace";
import type { Result } from "@mamep2026/domain";
import type { DataTypeResolver } from "@mamep2026/data-conversion";
import { createDataTypeResolver } from "@mamep2026/data-conversion";
import {
  addRowAfter,
  commitAddress,
  commitCellText as commitCellTextUseCase,
  commitChildCellText as commitChildCellTextUseCase,
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
  retargetRowDataType,
  rowTypeCountError,
  setBitComment as setBitCommentUseCase,
  setBitName as setBitNameUseCase,
  setChildMeta as setChildMetaUseCase,
  setRegisterBit as setRegisterBitUseCase,
  type ChildMetaPatch,
  type ClipboardIssue,
  type RowClipboardData,
} from "@mamep2026/register-table";
import {
  applySheetSnapshot,
  popRedo,
  popUndo,
  pushEntry,
  sheetFromSnapshot,
  snapshotSheet,
  type SheetEditSnapshot,
  type UndoEntry,
} from "@mamep2026/register-table";
import type { ThemeConfig } from "antd";
import { create } from "zustand";
import {
  applyCellCommit,
  applyCellValidation,
  applyManualResult,
  applyPollResultStatus,
  applyRowEdit,
  applyTypeValidation,
  createEmptyRowStatusState,
  type ApplyManualResultOptions,
  type RowFailure,
  type RowSuccess,
  type RowSuccessKind,
} from "./row-result";
import type { AppHost } from "./host";
import { hasPlatformCapability } from "./host-contracts";
import type { PersistedConnectionSettings } from "./components/connection-settings-model";
import { applyLanguage } from "./i18n";
import {
  copySheetName,
  createNamedSheet,
  createNamedWorkspace,
  ensureCoreSheets,
  initializeSheetNameCounters,
} from "./sheet-naming";

export type BufferSizeOption =
  "continue" | "100" | "500" | "1000" | "1500" | "2000" | "3000";

const TRACE_CONTINUE_CAPACITY = 10000;

export interface TraceWindowSample {
  no: number;
  value: string;
  rawValue: number;
  dataType: DataType;
}

export interface TraceAverageStats {
  sampleCount: number;
  firstNo: number;
  lastNo: number;
}

export interface TraceWindowModel {
  rowId: string;
  bufferSize: BufferSizeOption;
  /** Speed 滑块 0..100（Quick -> Slow）。 */
  speed: number;
  playing: boolean;
  samples: TraceWindowSample[];
  average: string | null;
  averageStats: TraceAverageStats | null;
}

/** 工作区导入预览摘要（PRD §8.3 P1）：确认导入前展示给用户。 */
export interface WorkspaceImportPreview {
  name: string;
  sheets: number;
  rows: number;
  connections: number;
  schemaVersion: number;
}

/** 工作区导入草稿：解析通过待确认的完整工作区 + 预览摘要。 */
export interface WorkspaceImportDraft {
  workspace: Workspace;
  preview: WorkspaceImportPreview;
}

export interface WorkspaceImportApplyOptions {
  /** 表格提交后下一帧再关闭确认框，避免大表替换与 Modal 卸载挤在同一 commit。 */
  deferDraftClear?: boolean;
}

/**
 * 原始 JSON 文本导入解析器。生产组合根注入 Worker 实现；UI 包不直接依赖
 * platform-web，测试/无注回退由 workspace-transfer 在本地执行。
 */
export type WorkspaceImportParser = (
  text: string,
  signal: AbortSignal,
) => Promise<Result<Workspace>>;

/**
 * Host 装配状态（启动骨架）：宿主实现按运行时平台动态加载（composition root
 * 在渲染前置 `"assembling"`），MamepApp 据此显示启动占位；装配失败以 `"failed"` 保持
 * 「无 Host 可操作」（能力入口依 host 为空自然禁用），不阻断应用。
 */
export type HostStatus = "assembling" | "ready" | "failed";

export interface AppStoreState {
  host: AppHost | null;
  workspace: Workspace;
  loaded: boolean;
  /**
   * Host 装配状态：**默认 `"ready"`**（非应用运行时——单测/组件隔离渲染不经动态装配）；
   * 真实启动由 `apps/web/src/main.tsx` 在渲染前置 `"assembling"`，由装配编排改写终态。
   */
  hostStatus: HostStatus;
  connectionState: ConnectionState;
  activeSheetId: SheetId | null;
  connectionModalOpen: boolean;
  /** 会话内已选串口（Header Connect 直连）：仅会话内存，不持久化（§19.3）。 */
  selectedSerialHandle: SerialDeviceHandle | null;
  /** 会话内已选串口端口 ID（enumerated 下拉框 value）；与 selectedSerialHandle 成对。 */
  selectedSerialPortId: string | null;
  /** 连接设置/直连的错误展示（决策 5）：Header 直连失败回退弹窗时经此显示；会话内，不持久化。 */
  connectError: string | null;
  settingsModalOpen: boolean;
  /** 帮助/关于弹窗（键盘操作：Ctrl+/ 或 ? 打开，入 store 供快捷键弹窗抑制）。 */
  helpModalOpen: boolean;
  pendingDeleteSheetId: SheetId | null;
  /** 批量关闭（关闭其他/右侧）确认弹窗状态；null 表示未在确认。 */
  pendingBulkClose: { kind: "others" | "right"; sheetId: SheetId } | null;
  theme: "light" | "dark";
  /** 所选主题色预设：null=内置 Ant Design 默认蓝；插件色=`<pluginId>:<colorId>`；随工作区持久化。 */
  themePrimary: string | null;
  /**
   * 首帧主色种子：所选插件主题色**上次解析出**的
   * `colorPrimary`（启动缓存恢复写入，插件就绪后由 `MamepApp` 回写）。仅用于「插件贡献尚未就绪」的
   * 过渡着色 —— 主题色的唯一事实源仍是工作区 `preferences.themePrimary`。
   */
  themeColorSeed: string | null;
  /**
   * 插件注册表就绪（`host.startPlugins()` 落定）：就绪后主色以注册表为准
   * （解析不到 = 插件已禁用/卸载 → 回退默认蓝）；装配编排经 sinks 置位。
   */
  pluginsReady: boolean;
  /**
   * 宿主提供的完整 antd 主题（VSCode 完整令牌映射，ui-theme buildVscodeTheme 产出）；
   * null=回退 buildTheme 两态。运行时派生（随宿主主题事件更新），不持久化。
   */
  themeConfig: ThemeConfig | null;
  /** 数据类型解析器：内置 + 插件类型；App.tsx 装配后注入。 */
  dataTypeResolver: DataTypeResolver;
  saveStatus: SaveStatus;
  /** 工作区加载恢复元数据（恢复提示）：加载后由 App.tsx 写入；null=无恢复。 */
  workspaceRecovery: WorkspaceRecoveryInfo | null;
  /** 撤销/重做历史栈（TECH_DESIGN §24.4；纯内存会话状态，不随工作区持久化）。 */
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  messages: ApplicationMessage[];
  commLog: CommunicationLogEntry[];
  traceWindows: Record<string, TraceWindowModel>;
  pollingKeys: Record<string, string>;
  /** 当前会话中每行最近一次轮询结果；不持久化，加载工作区或重新开启 WP 时清除。 */
  pollingOutcomes: Record<RowId, "success" | "failure" | undefined>;
  /** 行操作结果三态状态点（纯 UI 会话状态，不持久化，§19.2 同 selectedRowIds）。 */
  rowResults: Record<RowId, RowFailure | undefined>;
  rowDirty: Record<RowId, boolean>;
  rowSuccess: Record<RowId, RowSuccess | undefined>;
  /** Data/地址列编辑校验错误（纯 UI 会话状态，不持久化；键=`${rowId}:data|address`）。 */
  cellValidationErrors: Record<string, RowFailure | undefined>;
  /** 工作区导入草稿（解析通过待确认；null=无待确认导入）。纯 UI 会话状态，不持久化。 */
  workspaceImportDraft: WorkspaceImportDraft | null;
  workspaceImportParser: WorkspaceImportParser | null;

  setHost: (host: AppHost) => void;
  /** 设置 Host 装配状态（启动骨架；由装配编排调用）。 */
  setHostStatus: (status: HostStatus) => void;
  /** 注入数据类型解析器：App.tsx 装配插件 dataType 运行时后调用。 */
  setDataTypeResolver: (resolver: DataTypeResolver) => void;
  setWorkspace: (workspace: Workspace) => void;
  /** 设置工作区导入草稿（解析通过待确认）；null 清除/关闭预览。 */
  setWorkspaceImportDraft: (draft: WorkspaceImportDraft | null) => void;
  /** 注入原始 JSON 文本解析器（生产组合根提供 Worker 实现）。 */
  setWorkspaceImportParser: (parser: WorkspaceImportParser | null) => void;
  /**
   * 应用当前导入草稿替换工作区（清空撤销栈、触发自动保存）；无草稿时 no-op。
   * expectedDraft 用于取消后阻止已排队提交作用于新草稿。
   */
  applyWorkspaceImport: (
    expectedDraft?: WorkspaceImportDraft,
    options?: WorkspaceImportApplyOptions,
  ) => void;
  /** Complete startup with all core sheet types in the same state update. */
  setLoaded: () => void;
  setConnectionState: (state: ConnectionState) => void;
  setConnectionModalOpen: (open: boolean) => void;
  setSerialSelection: (
    handle: SerialDeviceHandle | null,
    portId: string | null,
  ) => void;
  setConnectError: (error: string | null) => void;
  setSettingsModalOpen: (open: boolean) => void;
  setHelpModalOpen: (open: boolean) => void;
  setPendingDeleteSheetId: (sheetId: SheetId | null) => void;
  setPendingBulkClose: (
    pendingBulkClose: { kind: "others" | "right"; sheetId: SheetId } | null,
  ) => void;
  setTheme: (theme: "light" | "dark") => void;
  /**
   * 所选主题色预设：null=内置默认蓝；插件色 = `<pluginId>:<colorId>`（完整预设 ID）。
   * 持久化到 workspace.preferences.themePrimary（随自动保存）。
   */
  setThemePrimary: (primary: string | null) => void;
  /** 回写「上次解析出的主色种子」（仅插件就绪后调用；用于首帧过渡与启动缓存）。 */
  setThemeColorSeed: (seed: string | null) => void;
  /** 置插件注册表就绪（装配编排在 `host.startPlugins()` 落定后调用，fail-open）。 */
  setPluginsReady: (ready: boolean) => void;
  /** 撤销上一步工作区编辑（TECH_DESIGN §24.4）；无可撤销项时 no-op。 */
  undo: () => void;
  /** 重做被撤销的编辑；无重做项时 no-op。 */
  redo: () => void;
  /** 设置宿主完整主题（VSCode ui-theme；null=回退 buildTheme 两态）。运行时派生，不持久化。 */
  setThemeConfig: (themeConfig: ThemeConfig | null) => void;
  /** 记录界面语言选择到工作区偏好（随自动保存持久化；i18n 引擎切换由组件层调用）。 */
  setLanguage: (language: "en-US" | "zh-CN") => void;
  /** 更新活动连接配置的持久化设置（除串口/端口选择外的全部参数），随自动保存持久化。 */
  setConnectionSettings: (settings: PersistedConnectionSettings) => void;
  setSaveStatus: (status: SaveStatus) => void;
  /** 设置工作区加载恢复元数据（恢复提示）；null 清除。 */
  setWorkspaceRecovery: (recovery: WorkspaceRecoveryInfo | null) => void;
  setActiveSheetId: (sheetId: SheetId) => void;
  /** 更新工作区面板布局（侧栏/底部面板折叠、高度、活动 tab），随自动保存持久化。 */
  setPanelLayout: (partial: Partial<PanelLayout>) => void;

  updateRow: (rowId: RowId, updater: (row: RegisterRow) => RegisterRow) => void;
  /** 修改行 Name（可撤销，§24.4）；Data 等运行时字段不走此路径。 */
  setRowName: (rowId: RowId, name: string) => void;
  /** 修改行 Comment（可撤销，§24.4）。 */
  setRowComment: (rowId: RowId, comment: string) => void;
  /** 修改行 WP 轮询开关（可撤销，§24.4「修改轮询设置」）。 */
  setPollingEnabled: (rowId: RowId, enabled: boolean) => void;
  commitRowAddress: (rowId: RowId, draft: string) => Result<RegisterRow>;
  /** 提交 Data 单元格文本：按 Type 校验；失败保留输入并记录校验错误（§17/§23）。 */
  commitCellText: (rowId: RowId, text: string) => Result<RegisterRow>;
  /** 提交范围行子行 Data：按子行自身 Type 校验/解析，回写父行 registerValues[i] 并重算父行组合文本。 */
  commitChildCellText: (
    parentRowId: RowId,
    index: number,
    text: string,
  ) => Result<RegisterRow>;
  /** 更新范围行子行独立元数据（name/comment/dataType），随父行持久化。 */
  setChildMeta: (
    parentRowId: RowId,
    index: number,
    patch: ChildMetaPatch,
  ) => void;
  /**
   * 位明细：设置某寄存器的一位（0/1）。
   * 只改当前值（registerValues + 父行 cellText），**不写设备、不入撤销栈**（与 Data 编辑一致）。
   * `registerRowId`：该寄存器所在行（单寄存器行=自身；范围行=父行），`registerIndex` 为寄存器序号。
   */
  setRegisterBitValue: (
    registerRowId: RowId,
    registerIndex: number,
    bit: number,
    value: 0 | 1,
  ) => void;
  /**
   * 位明细：写入某寄存器的位注释（空串=清除）。
   * 属编辑字段（同 Name/Comment），随工作区持久化并**入撤销栈**。
   */
  setBitComment: (
    parentRowId: RowId,
    registerIndex: number,
    bit: number,
    comment: string,
  ) => void;
  /**
   * 位明细：写入某寄存器的位名称（空串=清除）。
   * 与 `setBitComment` 完全对称（编辑字段、入撤销栈）。
   */
  setBitName: (
    parentRowId: RowId,
    registerIndex: number,
    bit: number,
    name: string,
  ) => void;
  addRow: (sheetId: SheetId) => void;
  deleteRow: (sheetId: SheetId, rowId: RowId) => void;
  moveRow: (sheetId: SheetId, rowId: RowId, direction: "up" | "down") => void;
  /** dnd-kit 拖拽排序：把行移动到目标索引（arrayMove 语义，越界钳制）。 */
  moveRowToIndex: (sheetId: SheetId, rowId: RowId, targetIndex: number) => void;
  duplicateRowInSheet: (sheetId: SheetId, rowId: RowId) => void;
  /** 行多选与剪贴板：会话状态，不随工作区持久化（§19.2）。 */
  selectedRowIds: RowId[];
  /** 应用内剪贴板（行级）：copy/cut 填充，paste 优先系统剪贴板、回退此处。 */
  clipboardPayload: RowClipboardData[] | null;
  /** 剪贴板来源表类型：跨类型粘贴被拒；null=无来源（外部 CSV）不限制。 */
  clipboardSourceSheetType: SheetType | null;
  setSelectedRowIds: (rowIds: RowId[]) => void;
  insertRowAfter: (sheetId: SheetId, rowId: RowId) => void;
  insertRowBefore: (sheetId: SheetId, rowId: RowId) => void;
  moveSelectedRows: (sheetId: SheetId, direction: "up" | "down") => void;
  deleteSelectedRows: (sheetId: SheetId) => void;
  copySelectedRows: (sheetId: SheetId) => void;
  cutSelectedRows: (sheetId: SheetId) => void;
  /** 粘贴到 afterRowId 之后；afterRowId 为 null 时追加到表尾。 */
  pasteRows: (sheetId: SheetId, afterRowId: RowId | null) => Promise<void>;
  /** Create a typed sheet; plugin callers may supply their English group title. */
  addSheet: (type?: SheetType, englishTitle?: string) => void;
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
  /** 设置某张表的 Register 地址列进制（DEC/HEX），随自动保存持久化。 */
  setSheetRegisterRadix: (sheetId: SheetId, radix: RegisterRadix) => void;
  /** 设置某张表的 Slave Address（每表独立，随表持久化，IndexedDB 自动保存）。 */
  setSheetSlaveAddress: (sheetId: SheetId, slave: number) => void;
  /** 设置某张表的写后回读配置（每表独立，随表持久化）。 */
  setSheetWriteVerify: (sheetId: SheetId, settings: ReadVerifySettings) => void;
  /** 设置某张表的表级地址变换配置（每表独立，随表持久化；可撤销）。 */
  setSheetAddressTransform: (
    sheetId: SheetId,
    config: AddressTransformConfig | null,
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
  appendTraceSample: (rowId: RowId, sample: TraceWindowSample) => void;
  setTraceAverage: (
    rowId: RowId,
    average: string | null,
    stats?: TraceAverageStats | null,
  ) => void;

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

// ---- 撤销/重做辅助（工作区级应用逻辑，TECH_DESIGN §24.4）----

/** 取指定表；不存在返回 undefined。 */
function findSheetById(
  workspace: Workspace,
  sheetId: SheetId,
): RegisterSheet | undefined {
  return workspace.sheets.find((s) => s.sheetId === sheetId);
}

/** 入栈一个「表内容」撤销条目（新编辑自动清空重做栈，见 pushEntry）。 */
function pushSheetEntry(
  get: () => AppStoreState,
  set: (partial: Partial<AppStoreState>) => void,
  sheetId: SheetId,
  before: SheetEditSnapshot | null,
  after: SheetEditSnapshot | null,
): void {
  const state = get();
  const next = pushEntry(
    { undoStack: state.undoStack, redoStack: state.redoStack },
    { kind: "sheet", sheetId, before, after },
  );
  set({ undoStack: next.undoStack, redoStack: next.redoStack });
}

/** 入栈一个「表顺序重排」撤销条目。 */
function pushReorderEntry(
  get: () => AppStoreState,
  set: (partial: Partial<AppStoreState>) => void,
  before: SheetId[],
  after: SheetId[],
): void {
  const state = get();
  const next = pushEntry(
    { undoStack: state.undoStack, redoStack: state.redoStack },
    { kind: "sheets-reorder", before, after },
  );
  set({ undoStack: next.undoStack, redoStack: next.redoStack });
}

/**
 * 行字段编辑事务（可撤销）：捕获编辑前表快照 → 应用 updater → 捕获编辑后快照 → 入栈。
 * 仅用于结构化编辑字段（Name/Comment/WP 等）；读值/Data 文本等运行时更新不走此路径。
 */
function commitRowEdit(
  get: () => AppStoreState,
  set: (partial: Partial<AppStoreState>) => void,
  rowId: RowId,
  updater: (row: RegisterRow) => RegisterRow,
): void {
  const state = get();
  const sheet = state.workspace.sheets.find((s) =>
    s.rows.some((r) => r.rowId === rowId),
  );
  const row = sheet?.rows.find((r) => r.rowId === rowId);
  if (row === undefined || sheet === undefined) return;
  const before = snapshotSheet(sheet);
  get().updateRow(rowId, updater);
  const afterSheet = findSheetById(get().workspace, sheet.sheetId);
  if (afterSheet !== undefined) {
    pushSheetEntry(get, set, sheet.sheetId, before, snapshotSheet(afterSheet));
  }
}

/** 活动表修复：activeSheetId 指向**不存在或未打开**的表时回退到首个打开的表。
 *  起要求目标表已打开：未打开的表不出现在 Tab 栏，指针落在它上面会让界面卡在
 * 「没有打开的表」空态（导入 / 外部编辑工作区文件 / 插件卸载均可能造出这种指针）。 */
function fixActiveSheetId(
  sheets: RegisterSheet[],
  activeSheetId: SheetId | null,
): SheetId | null {
  if (
    activeSheetId !== null &&
    sheets.some((s) => s.sheetId === activeSheetId && s.open)
  ) {
    return activeSheetId;
  }
  return sheets.find((s) => s.open)?.sheetId ?? sheets[0]?.sheetId ?? null;
}

/**
 * 撤销/重做应用表快照后，把「快照恢复的 Type」与「未回退的运行时文本」对齐。
 * `cellText` 属运行时字段（§24.4 不随撤销回退），若快照恢复的 `dataType` 与当前不同，
 * 必须按「现类型解析现文本 → 恢复类型格式化」刷新，否则会残留「类型 A + 文本 B」
 * （并发作写入时按新类型解析旧文本的隐患）。
 */
function retargetSnapshotRowTypes(
  liveSheet: RegisterSheet,
  restored: RegisterSheet,
  resolver: DataTypeResolver,
): RegisterSheet {
  const liveRows = new Map(liveSheet.rows.map((row) => [row.rowId, row]));
  let changed = false;
  const rows = restored.rows.map((row) => {
    const live = liveRows.get(row.rowId);
    if (live === undefined || live.dataType === row.dataType) return row;
    changed = true;
    return retargetRowDataType(
      { ...row, dataType: live.dataType, cellText: live.cellText },
      row.dataType,
      resolver,
    );
  });
  return changed ? { ...restored, rows } : restored;
}

/** 把表编辑快照应用到工作区：表存在→恢复结构（并同步 Type ↔ 文本）；
 *  不存在→重建并放回原 order 位置。 */
function applySheetSnapshotToWorkspace(
  workspace: Workspace,
  sheetId: SheetId,
  snapshot: SheetEditSnapshot,
  resolver: DataTypeResolver,
): { workspace: Workspace; activeSheetId: SheetId | null } {
  const existing = workspace.sheets.find((s) => s.sheetId === sheetId);
  const sheets =
    existing === undefined
      ? [...workspace.sheets, sheetFromSnapshot(snapshot)].sort(
          (a, b) => a.order - b.order,
        )
      : workspace.sheets.map((s) =>
          s.sheetId === sheetId
            ? retargetSnapshotRowTypes(
                s,
                applySheetSnapshot(s, snapshot),
                resolver,
              )
            : s,
        );
  return {
    workspace: { ...workspace, sheets, updatedAt: Date.now() },
    activeSheetId: fixActiveSheetId(sheets, workspace.activeSheetId),
  };
}

type SheetRemoval = NonNullable<
  Extract<UndoEntry, { kind: "sheet" }>["removal"]
>;

/** Remove a sheet, retaining one sheet of its core type and recording the result. */
function removeSheetFromWorkspace(
  workspace: Workspace,
  sheetId: SheetId,
  saved?: SheetRemoval,
): {
  workspace: Workspace;
  activeSheetId: SheetId | null;
  removal: SheetRemoval;
} {
  const initialized = initializeSheetNameCounters(workspace);
  const original = findSheetById(initialized, sheetId);
  if (original === undefined) throw new Error("Cannot remove a missing sheet.");
  const without = initialized.sheets.filter((s) => s.sheetId !== sheetId);
  const lastOfCoreType =
    isCoreSheetType(original.type) &&
    !without.some((sheet) => sheet.type === original.type);
  // Allocate only on the first removal. Keep the existing empty-workspace fallback for plugins.
  const fallback =
    saved === undefined && (lastOfCoreType || without.length === 0)
      ? createNamedSheet(
          initialized,
          lastOfCoreType ? original.type : "holding-register",
        )
      : null;
  const replacement =
    saved !== undefined
      ? saved.replacement
      : fallback === null
        ? null
        : { ...fallback.sheet, order: original.order };
  const index =
    saved?.index ??
    initialized.sheets.findIndex((sheet) => sheet.sheetId === sheetId);
  const sheets = [...without];
  if (replacement !== null) sheets.splice(index, 0, replacement);
  const activeSheetId =
    saved !== undefined
      ? saved.activeAfter
      : (replacement?.sheetId ??
        fixActiveSheetId(sheets, workspace.activeSheetId));
  const removal = saved ?? {
    original,
    replacement,
    index,
    activeBefore: workspace.activeSheetId,
    activeAfter: activeSheetId,
  };
  return {
    workspace: {
      ...(fallback?.workspace ?? initialized),
      sheets,
      activeSheetId,
      updatedAt: Date.now(),
    },
    activeSheetId,
    removal,
  };
}

/** Restore the complete removed sheet and remove only its recorded replacement. */
function restoreRemovedSheet(
  workspace: Workspace,
  removal: SheetRemoval,
): { workspace: Workspace; activeSheetId: SheetId | null } {
  const sheets = workspace.sheets.filter(
    (sheet) =>
      sheet.sheetId !== removal.replacement?.sheetId &&
      sheet.sheetId !== removal.original.sheetId,
  );
  sheets.splice(removal.index, 0, removal.original);
  const activeSheetId =
    removal.activeBefore === null
      ? null
      : fixActiveSheetId(sheets, removal.activeBefore);
  return {
    workspace: { ...workspace, sheets, activeSheetId, updatedAt: Date.now() },
    activeSheetId,
  };
}

/** 按 sheetId 顺序重排表（撤销/重做表顺序移动）；不在顺序里的表追加末尾。 */
function reorderSheetsInWorkspace(
  workspace: Workspace,
  order: readonly SheetId[],
): Workspace {
  const byId = new Map(workspace.sheets.map((s) => [s.sheetId, s]));
  const ordered = order
    .map((id) => byId.get(id))
    .filter((s): s is RegisterSheet => s !== undefined);
  const remaining = workspace.sheets.filter((s) => !order.includes(s.sheetId));
  const sheets = [
    ...ordered.map((s, index) => ({ ...s, order: index })),
    ...remaining.map((s, index) => ({ ...s, order: ordered.length + index })),
  ];
  return { ...workspace, sheets, updatedAt: Date.now() };
}

/**
 * 连接设置来自 `InputNumber` 等控件，提交前仍需做运行时边界校验。
 * 这里用轻量类型守卫替代 zod，避免仅因 store 的防御性校验把完整校验器带入首屏。
 */
function isPersistedConnectionSettings(
  value: PersistedConnectionSettings,
): boolean {
  if (value.protocol !== "rtu" && value.protocol !== "tcp") return false;
  const baseValid =
    Number.isInteger(value.retryCount) &&
    value.retryCount >= 0 &&
    value.retryCount <= 10 &&
    Number.isInteger(value.requestTimeoutMs);
  if (!baseValid) return false;
  if (value.protocol === "tcp") {
    return (
      typeof value.host === "string" &&
      value.host.length > 0 &&
      Number.isInteger(value.port) &&
      value.port >= 1 &&
      value.port <= 65535 &&
      Number.isInteger(value.unitId) &&
      value.unitId >= 0 &&
      value.unitId <= 255 &&
      value.requestTimeoutMs >= 50 &&
      value.requestTimeoutMs <= 60000 &&
      typeof value.autoReconnect === "boolean"
    );
  }
  return (
    Number.isInteger(value.baudRate) &&
    value.baudRate > 0 &&
    (value.dataBits === 7 || value.dataBits === 8) &&
    (value.stopBits === 1 || value.stopBits === 2) &&
    (value.parity === "none" ||
      value.parity === "even" ||
      value.parity === "odd") &&
    (value.flowControl === "off" || value.flowControl === "rts-cts") &&
    value.requestTimeoutMs >= 5 &&
    value.requestTimeoutMs <= 1000
  );
}

export const useAppStore = create<AppStoreState>()((set, get) => ({
  host: null,
  workspace: createNamedWorkspace(),
  loaded: false,
  hostStatus: "ready",
  connectionState: "disconnected",
  activeSheetId: null,
  connectionModalOpen: false,
  selectedSerialHandle: null,
  selectedSerialPortId: null,
  connectError: null,
  settingsModalOpen: false,
  helpModalOpen: false,
  pendingDeleteSheetId: null,
  pendingBulkClose: null,
  theme: "light",
  themePrimary: null,
  themeColorSeed: null,
  pluginsReady: false,
  themeConfig: null,
  // 缺省仅内置；App.tsx 装配插件 dataType 运行时后 setDataTypeResolver 替换。
  dataTypeResolver: createDataTypeResolver(),
  saveStatus: "idle",
  workspaceRecovery: null,
  undoStack: [],
  redoStack: [],
  messages: [],
  commLog: [],
  traceWindows: {},
  pollingKeys: {},
  pollingOutcomes: {},
  selectedRowIds: [],
  clipboardPayload: null,
  clipboardSourceSheetType: null,
  workspaceImportDraft: null,
  workspaceImportParser: null,
  ...createEmptyRowStatusState(),

  setHost: (host) => set({ host }),
  setHostStatus: (hostStatus) => set({ hostStatus }),
  setDataTypeResolver: (dataTypeResolver) => set({ dataTypeResolver }),
  setWorkspaceImportDraft: (workspaceImportDraft) =>
    set({ workspaceImportDraft }),
  setWorkspaceImportParser: (workspaceImportParser) =>
    set({ workspaceImportParser }),
  applyWorkspaceImport: (expectedDraft, options) => {
    const draft = get().workspaceImportDraft;
    if (draft === null) return;
    if (expectedDraft !== undefined && draft !== expectedDraft) return;
    // 导入语义对齐 setWorkspace：恢复语言/主题偏好 + 清空撤销栈。
    // 持久化由 App 层 workspace 变更订阅（scheduleSave）自动触发，无需手动保存。
    get().setWorkspace(draft.workspace);
    if (options?.deferDraftClear !== true) {
      set({ workspaceImportDraft: null });
    }
  },
  setWorkspace: (workspace) => {
    workspace = initializeSheetNameCounters(workspace);
    // 加载/重置工作区时恢复持久化的语言偏好（刷新后保持上次选择）。
    applyLanguage(workspace.preferences.language);
    // 失效指向兜底：仅在确有修正时新建对象（否则不产生多余的自动保存）。
    const correctedActiveSheetId = fixActiveSheetId(
      workspace.sheets,
      workspace.activeSheetId,
    );
    const nextWorkspace =
      correctedActiveSheetId === workspace.activeSheetId
        ? workspace
        : { ...workspace, activeSheetId: correctedActiveSheetId };
    return set((state) => ({
      workspace: nextWorkspace,
      // 会话态活动表让位给新加载的工作区（否则导入后可能残留指向旧表的 id）。
      activeSheetId: null,
      // 加载工作区时回填持久化的主题，避免刷新后恒为浅色。
      theme: workspace.preferences.theme ?? state.theme,
      // 加载工作区时回填用户自定义主题主色（null=默认品牌蓝）。
      themePrimary: workspace.preferences.themePrimary ?? null,
      // 加载/重置工作区后撤销历史无意义（新上下文），清空（会话状态不持久化，§24.4）。
      undoStack: [],
      redoStack: [],
      pollingOutcomes: {},
    }));
  },
  setLoaded: () =>
    set((state) => ({
      workspace: ensureCoreSheets(state.workspace),
      loaded: true,
    })),
  setConnectionState: (connectionState) => set({ connectionState }),
  setConnectionModalOpen: (connectionModalOpen) => set({ connectionModalOpen }),
  setSerialSelection: (selectedSerialHandle, selectedSerialPortId) =>
    set({ selectedSerialHandle, selectedSerialPortId }),
  setConnectError: (connectError) => set({ connectError }),
  setSettingsModalOpen: (settingsModalOpen) => set({ settingsModalOpen }),
  setHelpModalOpen: (helpModalOpen) => set({ helpModalOpen }),
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
  setThemePrimary: (themePrimary) =>
    set((state) => ({
      themePrimary,
      workspace: {
        ...state.workspace,
        preferences: {
          ...state.workspace.preferences,
          themePrimary,
        },
      },
    })),
  setThemeColorSeed: (themeColorSeed) => set({ themeColorSeed }),
  setPluginsReady: (pluginsReady) => set({ pluginsReady }),
  undo: () => {
    const state = get();
    const popped = popUndo({
      undoStack: state.undoStack,
      redoStack: state.redoStack,
    });
    if (popped.entry === null) return;
    let entry = popped.entry;
    let workspace = state.workspace;
    let activeSheetId = state.activeSheetId;
    if (entry.kind === "sheet") {
      const { sheetId, before } = entry;
      if (before === null) {
        // 编辑前表不存在（新增/复制表）：撤销 = 删除该表。
        const removed = removeSheetFromWorkspace(
          workspace,
          sheetId,
          entry.removal,
        );
        workspace = removed.workspace;
        activeSheetId = removed.activeSheetId;
        entry = { ...entry, removal: removed.removal };
      } else if (entry.removal !== undefined) {
        const restored = restoreRemovedSheet(workspace, entry.removal);
        workspace = restored.workspace;
        activeSheetId = restored.activeSheetId;
      } else {
        const applied = applySheetSnapshotToWorkspace(
          workspace,
          sheetId,
          before,
          get().dataTypeResolver,
        );
        workspace = applied.workspace;
        activeSheetId = applied.activeSheetId;
      }
    } else {
      // 表顺序重排：恢复到编辑前顺序（activeSheetId 不变，表均存在）。
      workspace = reorderSheetsInWorkspace(workspace, entry.before);
    }
    set({
      workspace,
      activeSheetId,
      undoStack: popped.state.undoStack,
      // 撤销后该条目可重做（进入重做栈）。
      redoStack: [...popped.state.redoStack, entry],
    });
  },
  redo: () => {
    const state = get();
    const popped = popRedo({
      undoStack: state.undoStack,
      redoStack: state.redoStack,
    });
    if (popped.entry === null) return;
    const entry = popped.entry;
    let workspace = state.workspace;
    let activeSheetId = state.activeSheetId;
    if (entry.kind === "sheet") {
      const { sheetId, after } = entry;
      if (after === null) {
        // 编辑后表不存在（删除表）：重做 = 再次删除。
        const removed = removeSheetFromWorkspace(
          workspace,
          sheetId,
          entry.removal,
        );
        workspace = removed.workspace;
        activeSheetId = removed.activeSheetId;
      } else if (entry.removal !== undefined) {
        const restored = restoreRemovedSheet(workspace, entry.removal);
        workspace = restored.workspace;
        activeSheetId = restored.activeSheetId;
      } else {
        const applied = applySheetSnapshotToWorkspace(
          workspace,
          sheetId,
          after,
          get().dataTypeResolver,
        );
        workspace = applied.workspace;
        activeSheetId = applied.activeSheetId;
      }
    } else {
      workspace = reorderSheetsInWorkspace(workspace, entry.after);
    }
    set({
      workspace,
      activeSheetId,
      // 重做后该条目回到撤销栈。
      undoStack: [...popped.state.undoStack, entry],
      redoStack: popped.state.redoStack,
    });
  },
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
      if (!isPersistedConnectionSettings(settings)) return {};
      const next = settings;
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
  setWorkspaceRecovery: (workspaceRecovery) => set({ workspaceRecovery }),
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

  setRowName: (rowId, name) =>
    commitRowEdit(get, set, rowId, (row) => ({
      ...row,
      name,
      updatedAt: Date.now(),
    })),
  setRowComment: (rowId, comment) =>
    commitRowEdit(get, set, rowId, (row) => ({
      ...row,
      comment,
      updatedAt: Date.now(),
    })),
  setPollingEnabled: (rowId, enabled) => {
    const current = get().pollingOutcomes;
    if (current[rowId] !== undefined) {
      const pollingOutcomes = { ...current };
      delete pollingOutcomes[rowId];
      set({ pollingOutcomes });
    }
    commitRowEdit(get, set, rowId, (row) => ({
      ...row,
      pollingEnabled: enabled,
      updatedAt: Date.now(),
    }));
  },

  commitRowAddress: (rowId, draft) => {
    // 按 rowId 在全部表中定位所属表，取该表的地址进制（每表独立）。
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
    const beforeSnapshot = result.ok ? snapshotSheet(sheet) : null;
    get().updateRow(rowId, (r) =>
      result.ok
        ? result.value
        : { ...r, addressDraft: draft, updatedAt: Date.now() },
    );
    // 撤销入栈：地址提交成功才记录（校验失败不改编辑字段，不入栈）。
    if (result.ok && beforeSnapshot !== null) {
      const afterSheet = findSheetById(get().workspace, sheet.sheetId);
      if (afterSheet !== undefined) {
        pushSheetEntry(
          get,
          set,
          sheet.sheetId,
          beforeSnapshot,
          snapshotSheet(afterSheet),
        );
      }
    }
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
      // 范围长度 × 类型合法集校验：不匹配在类型列报错（禁止读写）。
      const withType = applyTypeValidation(
        next,
        rowId,
        result.ok ? rowTypeCountError(result.value) : null,
      );
      return {
        rowResults: withType.rowResults,
        rowDirty: withType.rowDirty,
        rowSuccess: withType.rowSuccess,
        cellValidationErrors: withType.cellValidationErrors,
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
    const result = commitCellTextUseCase(row, text, get().dataTypeResolver);
    // §23 校验失败保留用户输入：cellText 回写；成功时由 result.value 更新（原引用短路零更新）。
    get().updateRow(rowId, (r) =>
      result.ok
        ? result.value
        : { ...r, cellText: text, updatedAt: Date.now() },
    );
    // 校验结果 → 行状态：成功清校验错误并置编辑完成态；失败记录校验错误、清设备失败/成功态。
    // after 用规范化后的文本：输入等价形式（如 00AB 手输 00ab）不视为值变化。
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
        result.ok ? result.value.cellText : text,
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

  commitChildCellText: (parentRowId, index, text) => {
    const sheets = get().workspace.sheets;
    const sheet = sheets.find((s) =>
      s.rows.some((r) => r.rowId === parentRowId),
    );
    const row = sheet?.rows.find((r) => r.rowId === parentRowId);
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
    const result = commitChildCellTextUseCase(
      row,
      index,
      text,
      get().dataTypeResolver,
    );
    // 成功：回写父行（registerValues[i] + 重算 cellText）；失败：子行草稿回退（不写坏父行组合文本）。
    if (result.ok) {
      get().updateRow(parentRowId, (r) =>
        r.rowId === result.value.rowId ? result.value : r,
      );
    }
    return result;
  },

  setChildMeta: (parentRowId, index, patch) => {
    const sheets = get().workspace.sheets;
    const sheet = sheets.find((s) =>
      s.rows.some((r) => r.rowId === parentRowId),
    );
    const row = sheet?.rows.find((r) => r.rowId === parentRowId);
    if (row === undefined || sheet === undefined) return;
    const result = setChildMetaUseCase(row, index, patch);
    if (!result.ok) return;
    // 范围行子行元数据修改（可撤销，§24.4；Data/读值路径不经过此）。
    const before = snapshotSheet(sheet);
    get().updateRow(parentRowId, (r) =>
      r.rowId === result.value.rowId ? result.value : r,
    );
    const afterSheet = findSheetById(get().workspace, sheet.sheetId);
    if (afterSheet !== undefined) {
      pushSheetEntry(
        get,
        set,
        sheet.sheetId,
        before,
        snapshotSheet(afterSheet),
      );
    }
  },

  setRegisterBitValue: (registerRowId, registerIndex, bit, value) => {
    const sheets = get().workspace.sheets;
    const sheet = sheets.find((s) =>
      s.rows.some((r) => r.rowId === registerRowId),
    );
    const row = sheet?.rows.find((r) => r.rowId === registerRowId);
    if (row === undefined) return;
    const result = setRegisterBitUseCase(
      row,
      registerIndex,
      bit,
      value,
      get().dataTypeResolver,
    );
    if (!result.ok) return;
    // 位值=当前值变更（与 Data 编辑一致）：不入撤销栈、不写设备。
    get().updateRow(registerRowId, (r) =>
      r.rowId === result.value.rowId ? result.value : r,
    );
  },

  setBitComment: (parentRowId, registerIndex, bit, comment) => {
    const sheets = get().workspace.sheets;
    const sheet = sheets.find((s) =>
      s.rows.some((r) => r.rowId === parentRowId),
    );
    const row = sheet?.rows.find((r) => r.rowId === parentRowId);
    if (row === undefined || sheet === undefined) return;
    const result = setBitCommentUseCase(row, registerIndex, bit, comment);
    if (!result.ok) return;
    // 位注释=编辑字段（可撤销，§24.4）。
    const before = snapshotSheet(sheet);
    get().updateRow(parentRowId, (r) =>
      r.rowId === result.value.rowId ? result.value : r,
    );
    const afterSheet = findSheetById(get().workspace, sheet.sheetId);
    if (afterSheet !== undefined) {
      pushSheetEntry(
        get,
        set,
        sheet.sheetId,
        before,
        snapshotSheet(afterSheet),
      );
    }
  },

  setBitName: (parentRowId, registerIndex, bit, name) => {
    const sheets = get().workspace.sheets;
    const sheet = sheets.find((s) =>
      s.rows.some((r) => r.rowId === parentRowId),
    );
    const row = sheet?.rows.find((r) => r.rowId === parentRowId);
    if (row === undefined || sheet === undefined) return;
    const result = setBitNameUseCase(row, registerIndex, bit, name);
    if (!result.ok) return;
    // 位名称=编辑字段（可撤销，与位注释一致）。
    const before = snapshotSheet(sheet);
    get().updateRow(parentRowId, (r) =>
      r.rowId === result.value.rowId ? result.value : r,
    );
    const afterSheet = findSheetById(get().workspace, sheet.sheetId);
    if (afterSheet !== undefined) {
      pushSheetEntry(
        get,
        set,
        sheet.sheetId,
        before,
        snapshotSheet(afterSheet),
      );
    }
  },

  addRow: (sheetId) => {
    const before = findSheetById(get().workspace, sheetId);
    if (before === undefined) return;
    const beforeSnapshot = snapshotSheet(before);
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
    });
    const after = findSheetById(get().workspace, sheetId);
    if (after !== undefined) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
  },

  deleteRow: (sheetId, rowId) => {
    const before = findSheetById(get().workspace, sheetId);
    if (before === undefined) return;
    const beforeSnapshot = snapshotSheet(before);
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
    }));
    const after = findSheetById(get().workspace, sheetId);
    if (after !== undefined) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
  },

  moveRow: (sheetId, rowId, direction) => {
    const before = findSheetById(get().workspace, sheetId);
    if (before === undefined) return;
    const beforeSnapshot = snapshotSheet(before);
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId ? moveRow(sheet, rowId, direction) : sheet,
        ),
        updatedAt: Date.now(),
      },
    }));
    const after = findSheetById(get().workspace, sheetId);
    if (after !== undefined) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
  },

  moveRowToIndex: (sheetId, rowId, targetIndex) => {
    const before = findSheetById(get().workspace, sheetId);
    if (before === undefined) return;
    const beforeSnapshot = snapshotSheet(before);
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
    }));
    const after = findSheetById(get().workspace, sheetId);
    if (after !== undefined) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
  },

  duplicateRowInSheet: (sheetId, rowId) => {
    const before = findSheetById(get().workspace, sheetId);
    if (before === undefined) return;
    const beforeSnapshot = snapshotSheet(before);
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId ? duplicateRow(sheet, rowId) : sheet,
        ),
        updatedAt: Date.now(),
      },
    }));
    const after = findSheetById(get().workspace, sheetId);
    if (after !== undefined) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
  },

  setSelectedRowIds: (rowIds) => set({ selectedRowIds: rowIds }),

  insertRowAfter: (sheetId, rowId) => {
    const before = findSheetById(get().workspace, sheetId);
    if (before === undefined) return;
    const beforeSnapshot = snapshotSheet(before);
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId ? addRowAfter(sheet, rowId) : sheet,
        ),
        updatedAt: Date.now(),
      },
    }));
    const after = findSheetById(get().workspace, sheetId);
    if (after !== undefined) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
  },

  insertRowBefore: (sheetId, rowId) => {
    const before = findSheetById(get().workspace, sheetId);
    if (before === undefined) return;
    const beforeSnapshot = snapshotSheet(before);
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId ? insertRowBefore(sheet, rowId) : sheet,
        ),
        updatedAt: Date.now(),
      },
    }));
    const after = findSheetById(get().workspace, sheetId);
    if (after !== undefined) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
  },

  moveSelectedRows: (sheetId, direction) => {
    const before = findSheetById(get().workspace, sheetId);
    if (before === undefined || get().selectedRowIds.length === 0) return;
    const beforeSnapshot = snapshotSheet(before);
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
    });
    const after = findSheetById(get().workspace, sheetId);
    // 批量移动到边界为 no-op（原引用不变），不产生撤销步骤。
    if (after !== undefined && after !== before) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
  },

  deleteSelectedRows: (sheetId) => {
    const before = findSheetById(get().workspace, sheetId);
    if (before === undefined || get().selectedRowIds.length === 0) return;
    const beforeSnapshot = snapshotSheet(before);
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
    });
    const after = findSheetById(get().workspace, sheetId);
    if (after !== undefined && after !== before) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
  },

  copySelectedRows: (sheetId) => {
    const state = get();
    const sheet = state.workspace.sheets.find((s) => s.sheetId === sheetId);
    if (sheet === undefined || state.selectedRowIds.length === 0) return;
    const payload = copyRowsToClipboard(sheet, state.selectedRowIds);
    set({ clipboardPayload: payload, clipboardSourceSheetType: sheet.type });
    const host = state.host;
    if (
      host !== null &&
      hasPlatformCapability(host.capabilities, "clipboard")
    ) {
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
    const beforeSnapshot = snapshotSheet(sheet);
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
      clipboardSourceSheetType: sheet.type,
      selectedRowIds: [],
    });
    const after = findSheetById(get().workspace, sheetId);
    if (after !== undefined && after !== sheet) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
    const host = state.host;
    if (
      host !== null &&
      hasPlatformCapability(host.capabilities, "clipboard")
    ) {
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
    // 跨类型粘贴被拒：不同类型表之间不可复制粘贴；外部 CSV（无来源）不限制。
    if (
      state.clipboardSourceSheetType !== null &&
      state.clipboardSourceSheetType !== sheet.type
    ) {
      get().appendMessage({
        timestamp: Date.now(),
        level: "warning",
        messageKey: "messages.clipboardTypeMismatch",
        params: {},
        detail: null,
      });
      return;
    }
    const beforeSnapshot = snapshotSheet(sheet);
    let payload: RowClipboardData[] | null = null;
    let issues: ClipboardIssue[] = [];
    const host = state.host;
    // 系统剪贴板为优先来源；读取失败/无内容时回退到应用内剪贴板。
    if (
      host !== null &&
      hasPlatformCapability(host.capabilities, "clipboard")
    ) {
      const readResult = await host.readTextFromClipboard();
      if (readResult.ok && readResult.value !== null) {
        const decoded = decodeClipboardCsv(
          readResult.value,
          get().dataTypeResolver.list(),
        );
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
      // Data 文本按行 Type 规范化：插件类型经注入 resolver。
      get().dataTypeResolver,
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
    const after = findSheetById(get().workspace, sheetId);
    if (after !== undefined && after !== sheet) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
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

  addSheet: (type, englishTitle) => {
    const beforeSheets = get().workspace.sheets;
    set((state) => {
      const { sheet, workspace } = createNamedSheet(
        state.workspace,
        type,
        englishTitle,
      );
      return {
        workspace: {
          ...workspace,
          sheets: [...state.workspace.sheets, sheet],
          activeSheetId: sheet.sheetId,
          updatedAt: Date.now(),
        },
        activeSheetId: sheet.sheetId,
      };
    });
    // 入栈：before=null（编辑前表不存在），after=新表快照。
    const newSheet = get().workspace.sheets.find(
      (s) => !beforeSheets.some((b) => b.sheetId === s.sheetId),
    );
    if (newSheet !== undefined) {
      pushSheetEntry(get, set, newSheet.sheetId, null, snapshotSheet(newSheet));
    }
  },

  renameSheet: (sheetId, name) => {
    const before = findSheetById(get().workspace, sheetId);
    if (before === undefined) return;
    const beforeSnapshot = snapshotSheet(before);
    set((state) => ({
      workspace: initializeSheetNameCounters({
        ...initializeSheetNameCounters(state.workspace),
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId ? { ...sheet, name } : sheet,
        ),
        updatedAt: Date.now(),
      }),
    }));
    const after = findSheetById(get().workspace, sheetId);
    if (after !== undefined) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
  },

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

  deleteSheet: (sheetId) => {
    const state = get();
    const before = findSheetById(state.workspace, sheetId);
    if (before === undefined) return;
    const removed = removeSheetFromWorkspace(state.workspace, sheetId);
    const history = pushEntry(
      { undoStack: state.undoStack, redoStack: state.redoStack },
      {
        kind: "sheet",
        sheetId,
        before: snapshotSheet(before),
        after: null,
        removal: removed.removal,
      },
    );
    // Publish deletion, replacement, selection and history as one state change.
    set({
      workspace: removed.workspace,
      activeSheetId: removed.activeSheetId,
      ...history,
    });
  },

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

  duplicateSheet: (sheetId) => {
    const beforeSheets = get().workspace.sheets;
    set((state) => {
      const sourceIndex = state.workspace.sheets.findIndex(
        (sheet) => sheet.sheetId === sheetId,
      );
      const source = state.workspace.sheets[sourceIndex];
      if (source === undefined) return state;
      const copy = createRegisterSheet(
        copySheetName(state.workspace, source.name),
        sourceIndex + 1,
        source.type,
      );
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
    });
    // 入栈：before=null（副本表编辑前不存在），after=副本表快照。
    const copySheet = get().workspace.sheets.find(
      (s) => !beforeSheets.some((b) => b.sheetId === s.sheetId),
    );
    if (copySheet !== undefined) {
      pushSheetEntry(
        get,
        set,
        copySheet.sheetId,
        null,
        snapshotSheet(copySheet),
      );
    }
  },

  moveSheetTo: (sheetId, toIndex) => {
    const beforeIds = get().workspace.sheets.map((s) => s.sheetId);
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
    });
    const afterIds = get().workspace.sheets.map((s) => s.sheetId);
    if (JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) {
      pushReorderEntry(get, set, beforeIds, afterIds);
    }
  },

  setRowDataType: (rowId, dataType) => {
    const state = get();
    const sheet = state.workspace.sheets.find((s) =>
      s.rows.some((r) => r.rowId === rowId),
    );
    const currentRow = sheet?.rows.find((r) => r.rowId === rowId);
    if (currentRow === undefined || sheet === undefined) return;
    const beforeSnapshot = snapshotSheet(sheet);
    // Type/Scale 切换即时刷新显示文本：按旧 Type 解析当前文本 → 新 Type 格式化写回；
    // 原始值不变、绝不按新进制重解释；解析失败/空文本保留原文。不算编辑（不置脏标记/完成态）。
    get().updateRow(rowId, (row) =>
      retargetRowDataType(row, dataType, get().dataTypeResolver),
    );
    // 撤销入栈：Type 修改（可撤销，§24.4）。
    const afterSheet = findSheetById(get().workspace, sheet.sheetId);
    if (afterSheet !== undefined) {
      pushSheetEntry(
        get,
        set,
        sheet.sheetId,
        beforeSnapshot,
        snapshotSheet(afterSheet),
      );
    }
    // 范围长度 × 类型合法集校验：类型切换后按当前 registerCount 重算类型列错误。
    const sheets = get().workspace.sheets;
    const row = sheets.flatMap((sh) => sh.rows).find((r) => r.rowId === rowId);
    if (row === undefined) return;
    set((state) => {
      const next = applyTypeValidation(
        { ...state, cellValidationErrors: state.cellValidationErrors },
        rowId,
        rowTypeCountError(row),
      );
      return { cellValidationErrors: next.cellValidationErrors };
    });
  },

  setSheetRegisterRadix: (sheetId, radix) => {
    const before = findSheetById(get().workspace, sheetId);
    if (before === undefined) return;
    const beforeSnapshot = snapshotSheet(before);
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
    }));
    const after = findSheetById(get().workspace, sheetId);
    if (after !== undefined) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
  },

  setSheetSlaveAddress: (sheetId, slave) => {
    if (!Number.isInteger(slave) || slave < 0 || slave > 255) return;
    const before = findSheetById(get().workspace, sheetId);
    if (before === undefined || before.slaveAddress === slave) return;
    const beforeSnapshot = snapshotSheet(before);
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
    }));
    const after = findSheetById(get().workspace, sheetId);
    if (after !== undefined) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
  },

  setSheetWriteVerify: (sheetId, settings) => {
    const before = findSheetById(get().workspace, sheetId);
    if (before === undefined) return;
    const beforeSnapshot = snapshotSheet(before);
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
    }));
    const after = findSheetById(get().workspace, sheetId);
    if (after !== undefined) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
  },

  setSheetAddressTransform: (sheetId, config) => {
    const before = findSheetById(get().workspace, sheetId);
    if (before === undefined) return;
    const beforeSnapshot = snapshotSheet(before);
    set((state) => ({
      workspace: {
        ...state.workspace,
        sheets: state.workspace.sheets.map((sheet) =>
          sheet.sheetId === sheetId
            ? { ...sheet, addressTransform: config, updatedAt: Date.now() }
            : sheet,
        ),
        updatedAt: Date.now(),
      },
    }));
    const after = findSheetById(get().workspace, sheetId);
    if (after !== undefined) {
      pushSheetEntry(get, set, sheetId, beforeSnapshot, snapshotSheet(after));
    }
  },

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
          // 修正后左侧为 Quick：40 仍对应旧默认的 860ms 采样间隔。
          speed: 40,
          // 打开窗口不自动开始采样，等待用户手动点击 Play。
          playing: false,
          samples: [],
          average: null,
          averageStats: null,
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
      const capacity =
        bufferSize === "continue"
          ? TRACE_CONTINUE_CAPACITY
          : Number(bufferSize);
      return {
        traceWindows: {
          ...state.traceWindows,
          [rowId]: {
            ...current,
            bufferSize,
            samples:
              current.samples.length > capacity
                ? current.samples.slice(current.samples.length - capacity)
                : current.samples,
            // 统计范围已改变，旧平均值不得继续显示。
            average: null,
            averageStats: null,
          },
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
        current.bufferSize === "continue"
          ? TRACE_CONTINUE_CAPACITY
          : Number(current.bufferSize);
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
  setTraceAverage: (rowId, average, stats = null) =>
    set((state) => {
      const current = state.traceWindows[rowId];
      if (current === undefined) return state;
      return {
        traceWindows: {
          ...state.traceWindows,
          [rowId]: { ...current, average, averageStats: stats },
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
      const outcome = result.ok ? "success" : "failure";
      const pollingOutcomes =
        state.pollingOutcomes[rowId] === outcome
          ? state.pollingOutcomes
          : { ...state.pollingOutcomes, [rowId]: outcome };
      if (
        next.rowResults === state.rowResults &&
        next.rowDirty === state.rowDirty &&
        next.rowSuccess === state.rowSuccess &&
        pollingOutcomes === state.pollingOutcomes
      ) {
        return state;
      }
      return {
        rowResults: next.rowResults,
        rowDirty: next.rowDirty,
        rowSuccess: next.rowSuccess,
        pollingOutcomes,
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
