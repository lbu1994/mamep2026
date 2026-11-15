/**
 * 工作区领域模型（docs/TECH_DESIGN.md §18）。
 * 只包含领域结构与受控工厂；运行时状态（连接、任务、Timer）不得进入该模型。
 */
import { defaultConfig } from "./config";
import type { RegisterAddress } from "./register-address";
import type { RawRegisterValue } from "./raw-value";
import type { Result } from "./result";
import type { TcpConnectionProfile } from "./tcp-profile";

/** 品牌化 ID：避免不同类型 ID 互相混用（docs/AGENTS.md §9.2）。 */
export type WorkspaceId = string & { readonly __brand: "WorkspaceId" };
export type SheetId = string & { readonly __brand: "SheetId" };
export type RowId = string & { readonly __brand: "RowId" };
export type ConnectionProfileId = string & {
  readonly __brand: "ConnectionProfileId";
};
export type PluginId = string & { readonly __brand: "PluginId" };

/** 内置 16 位数据类型字面量（E-3 后为闭集，插件类型经 string & {} 扩展）。 */
export type BuiltinDataType =
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
  | "binary"
  | "string"
  | "bool";

/**
 * 16 位数据类型（字符串联合，不用 enum 作序列化格式）。
 * 联合开放——内置字面量 + 插件类型（string & {}，单寄存器）。
 */
export type DataType = BuiltinDataType | (string & {});

export const dataTypes: readonly BuiltinDataType[] = [
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
  "string",
  "bool",
];

export function isBuiltinDataType(type: string): type is BuiltinDataType {
  return (dataTypes as readonly string[]).includes(type);
}

export type Parity = "none" | "even" | "odd";
export type FlowControl = "off" | "rts-cts" | "xon-xoff";
export type AddressAdjustMode = "off" | "on";
/** Register 地址列的显示/输入进制（按表独立设置，默认 DEC）。 */
export type RegisterRadix = "dec" | "hex";

/**
 * 内置 Address Adjust 变换 ID（插件）：核心开箱即用的唯一变换
 * （发送地址 = 用户地址 − 1）。迁移 v5→v6 与内置插件注册共用该 ID。
 */
export const BUILTIN_ADDRESS_ADJUST_TRANSFORM_ID = "builtin.address-adjust";

/**
 * 表级地址变换配置（插件）：随工作区持久化，每表独立。
 * null=不调整；transformId 指向 addressTransform 贡献点注册的变换（默认内置）。
 */
export interface AddressTransformConfig {
  transformId: string;
  enabled: boolean;
}

/**
 * 运行时地址变换（apply 为函数，不进入持久化/贡献点 payload；由插件 activate 注册）。
 * apply 失败（如 0 下溢）返回结构化错误，调用方保留用户输入。
 */
export interface AddressTransform {
  id: string;
  protocol: string;
  titleKey?: string;
  defaultConfig?: { enabled: boolean };
  apply(userAddress: number): Result<number>;
  validate?(userAddress: number): Result<null>;
}

/** RTU 连接配置（docs/TECH_DESIGN.md §18.4 字段）。 */
export interface RtuConnectionProfile {
  id: ConnectionProfileId;
  name: string;
  protocol: "rtu";
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: Parity;
  flowControl: FlowControl;
  requestTimeoutMs: number;
  retryCount: number;
  /** 仅作提示，不用于自动连接（§19.3） */
  recentPortHint: string | null;
}

/** 范围行子行独立元数据：每寄存器独立 Name/Comment/Type+Scale。 */
export interface RegisterSubRowMeta {
  name: string;
  comment: string;
  dataType: DataType;
}

/** 创建单个子行默认元数据（name/comment 为空，dataType 继承父行）。 */
export function createRegisterSubRowMeta(
  dataType: DataType,
): RegisterSubRowMeta {
  return { name: "", comment: "", dataType };
}

/** 按长度构建范围行子行元数据数组（缺省继承父行 dataType）。 */
export function createRegisterSubRowMetas(
  count: number,
  dataType: DataType,
): RegisterSubRowMeta[] {
  return Array.from({ length: count }, () =>
    createRegisterSubRowMeta(dataType),
  );
}

/**
 * 位级注释存储：
 * 外层 index = 寄存器序号（长度 = registerCount），内层长度固定 16、下标 = bit 号（0。15，显示时 bit15 在上）。
 * 某寄存器的 16 条注释全空时该元素为 `null`；整体全空时 `RegisterRow.bitComments` 为 `null`。
 */
export type RegisterBitComments = (string[] | null)[];

/**
 * 位级名称存储：结构同 `RegisterBitComments`（与注释对称）。
 * 位 Name 列可编辑（同 Comment 列），随工作区持久化并入撤销栈。
 */
export type RegisterBitNames = (string[] | null)[];

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
  /** 覆盖的连续寄存器数：1=单寄存器；范围行 >1 */
  registerCount: number;
  dataType: DataType;
  /** WP：周期轮询开关 */
  pollingEnabled: boolean;
  /** TM：轨迹追踪开关（与轮询相互独立，§36） */
  traceEnabled: boolean;
  /** Data 单元格单一当前值（§15.1） */
  cellText: string;
  /** 各寄存器原始值（单一事实源，替代 lastKnownRawValue）：null=未读；长度=registerCount */
  registerValues: RawRegisterValue[] | null;
  /** 范围行子行元数据：null=单寄存器行或老数据；范围行（registerCount>1）为长度=registerCount 的数组。 */
  registers: RegisterSubRowMeta[] | null;
  /** 位级注释：null=无位注释；长度=registerCount 的数组，每项为长度 16 的注释数组（下标=bit 号）或 null。 */
  bitComments: RegisterBitComments | null;
  /** 位级名称：结构同 bitComments；位 Name 列可编辑（同 Comment 列）。 */
  bitNames: RegisterBitNames | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * 表类型（插件）：核心 "holding-register" 或插件表类型 "<pluginId>:<tableTypeId>"。
 * 核心再增 3 个基础表（coil / discrete-input / input-register，RTU 承载）。
 */
export type SheetType =
  | "holding-register"
  | "coil"
  | "discrete-input"
  | "input-register"
  | (string & {});

/** 核心表类型 ID：holding-register + 三个基础表。 */
export type CoreSheetType =
  "holding-register" | "coil" | "discrete-input" | "input-register";

/** 基础表类型：coil / discrete-input / input-register（不含 holding-register）。 */
export type BasicSheetType = "coil" | "discrete-input" | "input-register";

export const CORE_SHEET_TYPE_IDS: readonly CoreSheetType[] = [
  "holding-register",
  "coil",
  "discrete-input",
  "input-register",
];

export const BASIC_SHEET_TYPE_IDS: readonly BasicSheetType[] = [
  "coil",
  "discrete-input",
  "input-register",
];

/**
 * 基础表 codec 协议 ID：
 * codec 请求不携带表类型（CodecReadRequest 仅 slaveAddress+addresses），
 * 故每个基础表类型注册独立 codec 实例，protocolId = `${BASIC_TABLES_PROTOCOL_PREFIX}:${tableType}`
 * （如 "modbus-basic-tables:coil"）。CommunicationSession codec 路径零改动。
 */
export const BASIC_TABLES_PROTOCOL_PREFIX = "modbus-basic-tables";

export function basicTablesProtocolId(tableType: BasicSheetType): string {
  return `${BASIC_TABLES_PROTOCOL_PREFIX}:${tableType}`;
}

/** 核心表类型元数据：只读语义由表类型决定（不加模型字段）。 */
export interface CoreTableTypeMeta {
  id: CoreSheetType;
  /** i18n 标题键（完整键，如 "table.tableType.coil"）。 */
  titleKey: string;
  readable: boolean;
  writable: boolean;
  /** 新建表默认 dataType。 */
  defaultDataType: DataType;
  /** 值语义为 0/1 位（bool）：coil/discrete-input 读/写为位值。 */
  bitValue: boolean;
}

/** 核心表类型元数据表（单一事实源）：UI 只读守卫、新建表、协议映射共用。 */
export const CORE_TABLE_TYPES: readonly CoreTableTypeMeta[] = [
  {
    id: "holding-register",
    titleKey: "table.tableType.holdingRegister",
    readable: true,
    writable: true,
    defaultDataType: "hex",
    bitValue: false,
  },
  {
    id: "coil",
    titleKey: "table.tableType.coil",
    readable: true,
    writable: true,
    defaultDataType: "bool",
    bitValue: true,
  },
  {
    id: "discrete-input",
    titleKey: "table.tableType.discreteInput",
    readable: true,
    writable: false,
    defaultDataType: "hex",
    bitValue: true,
  },
  {
    id: "input-register",
    titleKey: "table.tableType.inputRegister",
    readable: true,
    writable: false,
    defaultDataType: "hex",
    bitValue: false,
  },
];

export function isCoreSheetType(type: string): type is CoreSheetType {
  return (CORE_SHEET_TYPE_IDS as readonly string[]).includes(type);
}

export function isBasicSheetType(type: string): type is BasicSheetType {
  return (BASIC_SHEET_TYPE_IDS as readonly string[]).includes(type);
}

export function coreTableTypeMeta(type: string): CoreTableTypeMeta | null {
  for (const meta of CORE_TABLE_TYPES) {
    if (meta.id === type) return meta;
  }
  return null;
}

/** 表类型是否可写（核心按元数据；未知插件类型缺省可写）。 */
export function sheetTypeWritable(type: string): boolean {
  const meta = coreTableTypeMeta(type);
  if (meta !== null) return meta.writable;
  return true;
}

export interface RegisterSheet {
  sheetId: SheetId;
  name: string;
  /** 表类型：核心 holding-register 或插件表类型（安川表 = "yaskawa-memobus-67h-010dh-010eh:holding-register"）。 */
  type: SheetType;
  order: number;
  /** 打开/关闭状态：关闭的表仍在工作区中（侧边栏保留），仅从页签栏隐藏；默认打开。 */
  open: boolean;
  rows: RegisterRow[];
  /** Register 地址列进制：默认 DEC（每表独立） */
  registerRadix: RegisterRadix;
  /** Slave Address（从站地址）：每表独立设置，默认 1；请求使用当前表的值 */
  slaveAddress: number;
  /** 各列拖拽宽度（每表独立，随工作区持久化；只含用户拖拽过的列，未记录列用默认宽） */
  columnWidths: Record<string, number>;
  /** 各列拖拽后的排列顺序（每表独立，随工作区持久化；null=未拖拽过，使用默认顺序） */
  columnOrder: string[] | null;
  /** 写后回读配置（每表独立，随工作区持久化）：默认立即回读（immediate）。 */
  writeVerify: ReadVerifySettings;
  /**
   * 表级地址变换配置（插件，每表独立，随工作区持久化）：
   * null=不调整；默认 null（迁移 v5→v6 把旧全局 profile.addressAdjust 复制到各表）。
   */
  addressTransform: AddressTransformConfig | null;
  createdAt: number;
  updatedAt: number;
}

export interface PollingSettings {
  /** 当前仅支持每行 WP 手动开关 */
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
  /** 侧边栏展开态宽度（px 侧边栏可拖宽）。 */
  sidebarWidth: number;
  bottomPanelCollapsed: boolean;
  bottomPanelHeight: number;
  activeBottomTab: string;
}

/** 侧边栏展开态默认宽度（px）。 */
export const DEFAULT_SIDEBAR_WIDTH = 160;

export interface Preferences {
  theme: "light" | "dark";
  /** 界面语言（用户偏好，随工作区持久化；默认 en-US）。 */
  language: "en-US" | "zh-CN";
  /**
   * 所选主题色预设（逆转任意取色；随工作区持久化）。
   * null=内置 Ant Design 默认蓝；插件注册色 = `<pluginId>:<colorId>`（完整预设 ID）。
   * 禁用/卸载插件后解析不到 → 回退默认；schema v7→v8 迁移旧任意 HEX → null。
   */
  themePrimary: string | null;
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
  connectionProfiles: (RtuConnectionProfile | TcpConnectionProfile)[];
  activeConnectionProfileId: ConnectionProfileId | null;
  pollingSettings: PollingSettings;
  panelLayout: PanelLayout;
  preferences: Preferences;
  notes: string;
  pluginStates: PluginState[];
  migrationHistory: MigrationRecord[];
}

/** 当前工作区 Schema 版本：v10。 */
export const workspaceSchemaVersion = 10;

/**
 * 工作区加载/恢复元数据：
 * 供 UI 在 `load()` 后经 `getRecoveryInfo()` 旁路读取，用于「恢复提示」；
 * 不改变 `load()` 的 `Result<Workspace>` 成功契约。
 * - `source:"none"`：主数据完好（正常恢复，不提示）；
 * - `source:"backup"`：主数据损坏，从备份恢复（提示来源=备份、恢复时间）；
 * - `source:"fresh"`：主+备份均不可用，应用以空工作区保持可操作（提示恢复失败已重置）。
 */
export interface WorkspaceRecoveryInfo {
  /** 是否发生了恢复（备份恢复 / 重建为空工作区）。 */
  recovered: boolean;
  /** 恢复来源。 */
  source: "none" | "backup" | "fresh";
  /** 发生恢复的时间戳（ms）。 */
  recoveredAt: number;
  /** 若从备份恢复，备份的写入时间戳（可空，IndexedDB 无法可靠记录时置 null）。 */
  backupTimestamp: number | null;
  /** 恢复失败时的错误码/类别（`source:"fresh"` 时携带）。 */
  errorCode: string | null;
}

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
    requestTimeoutMs: c.requestTimeoutMs,
    retryCount: c.retryCount,
    recentPortHint: null,
  };
}

/** 创建默认 TCP 连接配置（值来自集中 defaultConfig）。 */
export function createDefaultTcpProfile(name = "TCP"): TcpConnectionProfile {
  const c = defaultConfig.tcp;
  return {
    id: newConnectionProfileId(),
    name,
    protocol: "tcp",
    // 默认 host 置空（Header Connect 直连）：删除默认占位 "127.0.0.1"，
    // 使「TCP 已填入 IP」以 host 非空为准——首次需用户在连接设置里显式填写。
    host: "",
    port: 502,
    unitId: c.unitId,
    connectTimeoutMs: c.connectTimeoutMs,
    requestTimeoutMs: c.requestTimeoutMs,
    retryCount: c.retryCount,
    autoReconnect: c.autoReconnect,
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
    registerCount: 1,
    dataType: "hex",
    pollingEnabled: false,
    traceEnabled: false,
    cellText: "",
    registerValues: null,
    registers: null,
    bitComments: null,
    bitNames: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** 创建新的寄存器表标签页。 */
/** 新建表默认空行：order 从 1 连续编号（与 renumberRows 惯例一致）。 */
function createDefaultSheetRows(count: number): RegisterRow[] {
  return Array.from({ length: count }, (_, index) => {
    const row = createEmptyRow();
    row.order = index + 1;
    return row;
  });
}

export function createRegisterSheet(
  name: string,
  order: number,
  type: SheetType = "holding-register",
): RegisterSheet {
  const now = Date.now();
  const meta = coreTableTypeMeta(type);
  const defaultDataType = meta?.defaultDataType ?? "hex";
  const rows = createDefaultSheetRows(
    defaultConfig.registerTable.defaultRowCount,
  );
  // 基础表：按表类型默认 dataType（coil → bool）。
  for (const row of rows) {
    row.dataType = defaultDataType;
  }
  return {
    sheetId: newSheetId(),
    name,
    type,
    order,
    open: true,
    rows,
    registerRadix: defaultConfig.registerTable.addressRadix,
    slaveAddress: defaultConfig.registerTable.slaveAddress,
    columnWidths: {},
    columnOrder: null,
    // 写后回读默认 ON（写入后立即回读）。
    writeVerify: { mode: "immediate", delayMs: null },
    // 表级地址变换默认关闭：不调整。
    addressTransform: null,
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
    panelLayout: {
      sidebarCollapsed: false,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      bottomPanelCollapsed: false,
      bottomPanelHeight: 200,
      activeBottomTab: "messages",
    },
    preferences: { theme: "light", language: "en-US", themePrimary: null },
    notes: "",
    pluginStates: [],
    migrationHistory: [],
  };
}
