/**
 * 工作区领域模型（docs/TECH_DESIGN.md §18）。
 * 只包含领域结构与受控工厂；运行时状态（连接、任务、Timer）不得进入该模型。
 */
import { defaultConfig } from "./config";
import type { RegisterAddress } from "./register-address";
import type { RawRegisterValue } from "./raw-value";

/** 品牌化 ID：避免不同类型 ID 互相混用（docs/AGENTS.md §9.2）。 */
export type WorkspaceId = string & { readonly __brand: "WorkspaceId" };
export type SheetId = string & { readonly __brand: "SheetId" };
export type RowId = string & { readonly __brand: "RowId" };
export type ConnectionProfileId = string & {
  readonly __brand: "ConnectionProfileId";
};
export type PluginId = string & { readonly __brand: "PluginId" };

/** 16 位数据类型（字符串联合，不用 enum 作序列化格式）。 */
export type DataType =
  | "hex"
  | "unsigned"
  | "unsigned-0.1"
  | "unsigned-0.01"
  | "unsigned-0.001"
  | "unsigned-0.0001"
  | "signed"
  | "signed-0.1"
  | "signed-0.01"
  | "signed-0.001"
  | "signed-0.0001"
  | "binary";

export const dataTypes: readonly DataType[] = [
  "hex",
  "unsigned",
  "unsigned-0.1",
  "unsigned-0.01",
  "unsigned-0.001",
  "unsigned-0.0001",
  "signed",
  "signed-0.1",
  "signed-0.01",
  "signed-0.001",
  "signed-0.0001",
  "binary",
];

export type Parity = "none" | "even" | "odd";
export type FlowControl = "off" | "rts-cts" | "xon-xoff";
export type AddressAdjustMode = "off" | "on";

/** RTU 连接配置（docs/TECH_DESIGN.md §18.4，ADR-013 字段）。 */
export interface RtuConnectionProfile {
  id: ConnectionProfileId;
  name: string;
  protocol: "rtu";
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: Parity;
  flowControl: FlowControl;
  /** 0~255，默认 1；0 不触发广播写入 */
  slaveAddress: number;
  requestTimeoutMs: number;
  retryCount: number;
  /** Rx Delay：请求间隔，兼作 WP 轮询间隔，默认 50 ms */
  interRequestDelayMs: number;
  /** OFF（默认）| ON（发送地址 = 用户地址 - 1） */
  addressAdjust: AddressAdjustMode;
  /** 仅作提示，不用于自动连接（§19.3） */
  recentPortHint: string | null;
}

/** 寄存器行。addressDraft / addressValue / 校验状态分离（§17.2）。 */
export interface RegisterRow {
  rowId: RowId;
  order: number;
  name: string;
  comment: string;
  /** 用户正在编辑的原始文本 */
  addressDraft: string;
  /** 已提交的合法地址；为空表示未配置 */
  addressValue: RegisterAddress | null;
  dataType: DataType;
  /** WP：周期轮询开关 */
  pollingEnabled: boolean;
  /** TM：轨迹追踪开关（与轮询相互独立，§36） */
  traceEnabled: boolean;
  /** Data 单元格单一当前值（§15.1） */
  cellText: string;
  lastKnownRawValue: RawRegisterValue | null;
  createdAt: number;
  updatedAt: number;
}

export interface RegisterSheet {
  sheetId: SheetId;
  name: string;
  type: "holding-register";
  order: number;
  rows: RegisterRow[];
  createdAt: number;
  updatedAt: number;
}

export interface PollingSettings {
  /** MVP：仅支持每行 WP 手动开关 */
  enabledBehavior: "manual";
  /** 内部值，不提供用户配置 */
  maxPendingPollingTasks: number;
}

export interface ReadVerifySettings {
  mode: "off" | "immediate" | "delayed";
  delayMs: number | null;
}

export interface PanelLayout {
  sidebarCollapsed: boolean;
  bottomPanelCollapsed: boolean;
  bottomPanelHeight: number;
  activeBottomTab: string;
}

export interface Preferences {
  theme: "light" | "dark";
}

export interface PluginState {
  pluginId: PluginId;
  enabled: boolean;
  settings: Record<string, unknown>;
  lastKnownVersion: string | null;
  permissions: string[];
}

export interface MigrationRecord {
  fromVersion: number;
  toVersion: number;
  migratedAt: number;
}

export interface Workspace {
  schemaVersion: number;
  workspaceId: WorkspaceId;
  name: string;
  createdAt: number;
  updatedAt: number;
  activeSheetId: SheetId | null;
  sheets: RegisterSheet[];
  connectionProfiles: RtuConnectionProfile[];
  activeConnectionProfileId: ConnectionProfileId | null;
  pollingSettings: PollingSettings;
  readVerifySettings: ReadVerifySettings;
  panelLayout: PanelLayout;
  preferences: Preferences;
  notes: string;
  pluginStates: PluginState[];
  migrationHistory: MigrationRecord[];
}

/** 当前工作区 Schema 版本。 */
export const workspaceSchemaVersion = 1;

let idCounter = 0;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function newWorkspaceId(): WorkspaceId {
  return nextId("ws") as WorkspaceId;
}

export function newSheetId(): SheetId {
  return nextId("sheet") as SheetId;
}

export function newRowId(): RowId {
  return nextId("row") as RowId;
}

export function newConnectionProfileId(): ConnectionProfileId {
  return nextId("conn") as ConnectionProfileId;
}

/** 创建默认 RTU 连接配置（值来自集中 defaultConfig）。 */
export function createDefaultRtuProfile(name = "RTU"): RtuConnectionProfile {
  const c = defaultConfig.rtu;
  return {
    id: newConnectionProfileId(),
    name,
    protocol: "rtu",
    baudRate: c.baudRate,
    dataBits: c.dataBits,
    stopBits: c.stopBits,
    parity: c.parity,
    flowControl: c.flowControl,
    slaveAddress: c.slaveAddress,
    requestTimeoutMs: c.requestTimeoutMs,
    retryCount: c.retryCount,
    interRequestDelayMs: c.interRequestDelayMs,
    addressAdjust: c.addressAdjust,
    recentPortHint: null,
  };
}

/** 创建新的空寄存器行。 */
export function createEmptyRow(): RegisterRow {
  const now = Date.now();
  return {
    rowId: newRowId(),
    order: 0,
    name: "",
    comment: "",
    addressDraft: "",
    addressValue: null,
    dataType: "hex",
    pollingEnabled: false,
    traceEnabled: false,
    cellText: "",
    lastKnownRawValue: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** 创建新的寄存器表标签页。 */
export function createRegisterSheet(
  name: string,
  order: number,
): RegisterSheet {
  const now = Date.now();
  return {
    sheetId: newSheetId(),
    name,
    type: "holding-register",
    order,
    rows: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 创建空工作区：包含一个默认标签页与默认 RTU 连接配置；应用启动保持离线。 */
export function createEmptyWorkspace(): Workspace {
  const now = Date.now();
  const profile = createDefaultRtuProfile();
  const sheet = createRegisterSheet("Sheet 1", 0);
  return {
    schemaVersion: workspaceSchemaVersion,
    workspaceId: newWorkspaceId(),
    name: "Workspace",
    createdAt: now,
    updatedAt: now,
    activeSheetId: sheet.sheetId,
    sheets: [sheet],
    connectionProfiles: [profile],
    activeConnectionProfileId: profile.id,
    pollingSettings: {
      enabledBehavior: "manual",
      maxPendingPollingTasks: defaultConfig.polling.maxPendingPollingTasks,
    },
    readVerifySettings: { mode: "off", delayMs: null },
    panelLayout: {
      sidebarCollapsed: false,
      bottomPanelCollapsed: false,
      bottomPanelHeight: 200,
      activeBottomTab: "messages",
    },
    preferences: { theme: "light" },
    notes: "",
    pluginStates: [],
    migrationHistory: [],
  };
}
