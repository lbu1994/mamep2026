/**
 * 工作区持久化 Schema（docs/TECH_DESIGN.md §18、§19）。
 * 所有持久化数据经 Schema 校验后加载；运行时状态（连接、任务、Timer）不进入该 Schema。
 */
import {
  createMamepError,
  defaultConfig,
  RegisterAddress,
  RawRegisterValue,
  workspaceSchemaVersion,
  type ConnectionProfileId,
  type PluginId,
  type Result,
  type RowId,
  type SheetId,
  type Workspace,
  type WorkspaceId,
} from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import { z } from "zod";

const dataTypeSchema = z.enum([
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
]);

const rowSchema = z.object({
  rowId: z.string(),
  order: z.number().int(),
  name: z.string(),
  comment: z.string(),
  addressDraft: z.string(),
  addressValue: z.number().int().min(0).max(65535).nullable(),
  dataType: dataTypeSchema,
  pollingEnabled: z.boolean(),
  traceEnabled: z.boolean(),
  cellText: z.string(),
  lastKnownRawValue: z.number().int().min(0).max(65535).nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const sheetSchema = z.object({
  sheetId: z.string(),
  name: z.string(),
  type: z.literal("holding-register"),
  order: z.number().int(),
  /** 打开/关闭状态（2026-08-21）：关闭的表仍在工作区中（侧边栏保留），仅从页签栏隐藏；老数据缺省补 true，无需迁移 */
  open: z.boolean().default(true),
  rows: z.array(rowSchema),
  /** Register 地址列进制：默认 DEC（ADR-014）；老数据缺省时补默认值，无需迁移 */
  registerRadix: z.enum(["dec", "hex"]).default("dec"),
  /** 各列拖拽宽度（随表持久化，2026-08-18）；老数据缺省补默认 {}，无需迁移 */
  columnWidths: z
    .record(z.string(), z.number().finite().positive())
    .default({}),
  /** 各列拖拽后的排列顺序（随表持久化，2026-08-18）；老数据缺省补 null（默认顺序），无需迁移 */
  columnOrder: z.array(z.string()).nullable().default(null),
  /** Slave Address（每表独立，随表持久化，2026-08-19）；老数据缺省补默认 1，无需迁移 */
  slaveAddress: z.number().int().min(0).max(255).default(1),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/**
 * RTU 连接配置完整持久化（2026-08-17 确认）：除串口/端口选择外，波特率、数据位、
 * 停止位、校验位、流控等端口参数与超时、重试、请求间隔、Address Adjust
 * 均随工作区持久化（从站地址已按表独立设置，2026-08-19，见 sheetSchema.slaveAddress）。
 * 串口/端口选择本身是运行时会话状态，不进入持久化；
 * recentPortHint 仅作端口提示（docs/AGENTS.md §19.3），不用于自动连接。
 * 端口字段带默认值：兼容「端口参数未持久化」期间写入的旧数据（缺省回填默认值，无需迁移）。
 */
const rtuProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  protocol: z.literal("rtu"),
  baudRate: z.number().int().positive().default(defaultConfig.rtu.baudRate),
  dataBits: z
    .union([z.literal(7), z.literal(8)])
    .default(defaultConfig.rtu.dataBits as 7 | 8),
  stopBits: z
    .union([z.literal(1), z.literal(2)])
    .default(defaultConfig.rtu.stopBits as 1 | 2),
  parity: z
    .enum(["none", "even", "odd"])
    .default(defaultConfig.rtu.parity as "none" | "even" | "odd"),
  flowControl: z
    .enum(["off", "rts-cts", "xon-xoff"])
    .default(defaultConfig.rtu.flowControl as "off" | "rts-cts" | "xon-xoff"),
  requestTimeoutMs: z.number().int().min(0),
  retryCount: z.number().int().min(0).max(10),
  interRequestDelayMs: z.number().int().min(0),
  addressAdjust: z.enum(["off", "on"]),
  recentPortHint: z.string().nullable().default(null),
});

/**
 * TCP 连接配置持久化（2026-08-23 确认：入 workspace，恢复 host/port/unitId/超时/重试；
 * 保持离线、不自动连接）。unitId 0~255 默认 0；autoReconnect 为 P1 能力默认 false（UI 灰显）；
 * interRequestDelayMs 为内部字段（请求间隔，兼作 WP 轮询间隔）。
 */
const tcpProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  protocol: z.literal("tcp"),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  unitId: z
    .number()
    .int()
    .min(0)
    .max(255)
    .default(defaultConfig.tcp.unitId),
  connectTimeoutMs: z.number().int().min(0),
  requestTimeoutMs: z.number().int().min(0),
  retryCount: z.number().int().min(0).max(10),
  autoReconnect: z.boolean().default(defaultConfig.tcp.autoReconnect),
  interRequestDelayMs: z.number().int().min(0),
});

const pluginStateSchema = z.object({
  pluginId: z.string(),
  enabled: z.boolean(),
  settings: z.record(z.string(), z.unknown()),
  lastKnownVersion: z.string().nullable(),
  permissions: z.array(z.string()),
});

export const workspaceSchema = z.object({
  schemaVersion: z.number().int(),
  workspaceId: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  activeSheetId: z.string().nullable(),
  sheets: z.array(sheetSchema),
  connectionProfiles: z.array(
    z.discriminatedUnion("protocol", [rtuProfileSchema, tcpProfileSchema]),
  ),
  activeConnectionProfileId: z.string().nullable(),
  pollingSettings: z.object({
    enabledBehavior: z.literal("manual"),
    maxPendingPollingTasks: z.number().int(),
  }),
  readVerifySettings: z.object({
    mode: z.enum(["off", "immediate", "delayed"]),
    delayMs: z.number().nullable(),
  }),
  panelLayout: z.object({
    sidebarCollapsed: z.boolean(),
    bottomPanelCollapsed: z.boolean(),
    bottomPanelHeight: z.number(),
    activeBottomTab: z.string(),
  }),
  preferences: z.object({
    theme: z.enum(["light", "dark"]),
    /** 界面语言：默认 en-US；老数据缺省时补默认值，无需迁移。 */
    language: z.enum(["en-US", "zh-CN"]).default("en-US"),
  }),
  notes: z.string(),
  pluginStates: z.array(pluginStateSchema),
  migrationHistory: z.array(
    z.object({
      fromVersion: z.number().int(),
      toVersion: z.number().int(),
      migratedAt: z.number(),
    }),
  ),
});

export type WorkspaceData = z.infer<typeof workspaceSchema>;

function schemaInvalidError(technicalMessage: string) {
  return createMamepError({
    code: "WORKSPACE_SCHEMA_INVALID",
    category: "persistence",
    severity: "error",
    retryable: false,
    userMessageKey: "errors.workspaceSchemaInvalid",
    technicalMessage,
  });
}

/** 序列化工作区为 JSON 字符串（领域对象 -> 存储形态）。 */
export function serializeWorkspace(workspace: Workspace): string {
  const data: WorkspaceData = {
    ...workspace,
    sheets: workspace.sheets.map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row) => ({
        ...row,
        addressValue: row.addressValue?.value ?? null,
        lastKnownRawValue: row.lastKnownRawValue?.value ?? null,
      })),
    })),
  };
  return JSON.stringify(workspaceSchema.parse(data));
}

/** 解析并校验持久化数据，重建领域对象（受控工厂恢复值对象）。 */
export function parseWorkspace(input: unknown): Result<Workspace> {
  const validated = workspaceSchema.safeParse(input);
  if (!validated.success) {
    return fail(schemaInvalidError(validated.error.message));
  }
  const data = validated.data;

  const sheets = data.sheets.map((sheet) => {
    const rows = sheet.rows.map((row) => {
      const addressResult =
        row.addressValue === null
          ? null
          : RegisterAddress.create(row.addressValue);
      if (addressResult !== null && !addressResult.ok) {
        throw new Error(`stored address invalid: ${String(row.addressValue)}`);
      }
      const rawResult =
        row.lastKnownRawValue === null
          ? null
          : RawRegisterValue.create(row.lastKnownRawValue);
      if (rawResult !== null && !rawResult.ok) {
        throw new Error(
          `stored raw value invalid: ${String(row.lastKnownRawValue)}`,
        );
      }
      return {
        ...row,
        rowId: row.rowId as RowId,
        addressValue: addressResult === null ? null : addressResult.value,
        lastKnownRawValue: rawResult === null ? null : rawResult.value,
      };
    });
    return { ...sheet, sheetId: sheet.sheetId as SheetId, rows };
  });

  return ok({
    ...data,
    workspaceId: data.workspaceId as WorkspaceId,
    activeSheetId: data.activeSheetId as SheetId | null,
    connectionProfiles: data.connectionProfiles.map((profile) => ({
      ...profile,
      id: profile.id as ConnectionProfileId,
    })),
    activeConnectionProfileId:
      data.activeConnectionProfileId as ConnectionProfileId | null,
    sheets,
    pluginStates: data.pluginStates.map((state) => ({
      ...state,
      pluginId: state.pluginId as PluginId,
    })),
  });
}

/** 当前 schema 版本常量（与 domain 保持一致）。 */
export const currentWorkspaceSchemaVersion = workspaceSchemaVersion;
