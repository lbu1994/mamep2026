/**
 * 工作区持久化 Schema（docs/TECH_DESIGN.md §18、§19）。
 * 所有持久化数据经 Schema 校验后加载；运行时状态（连接、任务、Timer）不进入该 Schema。
 */
import {
  createMamepError,
  DEFAULT_SIDEBAR_WIDTH,
  defaultConfig,
  MAX_ROW_REGISTER_COUNT,
  validateWorkspaceExpansion,
  workspaceSchemaVersion,
  type Result,
  type Workspace,
} from "@mamep2026/domain";
import { fail, ok } from "@mamep2026/domain";
import { z } from "zod";
import { migrateData, migrations } from "./migrations";
import { hydrateWorkspaceData } from "./hydrate-workspace";

/**
 * dataType：开放字符串——内置字面量 + 插件类型（单寄存器）；
 * 不校验内容（插件类型在插件未加载时仍应可持久化往返）。
 */
const dataTypeSchema = z.string().min(1);

const rowSchema = z.object({
  rowId: z.string(),
  order: z.number().int(),
  name: z.string(),
  comment: z.string(),
  addressDraft: z.string(),
  addressValue: z.number().int().min(0).max(65535).nullable(),
  /** 覆盖的连续寄存器数：默认 1（单寄存器）；老数据缺省补默认，由 v2→v3 迁移补齐 */
  registerCount: z
    .number()
    .finite()
    .int()
    .min(1)
    .max(MAX_ROW_REGISTER_COUNT)
    .default(1),
  dataType: dataTypeSchema,
  pollingEnabled: z.boolean(),
  traceEnabled: z.boolean(),
  cellText: z.string(),
  /** 各寄存器原始值（替代 lastKnownRawValue）：null=未读 */
  registerValues: z.array(z.number().int().min(0).max(65535)).nullable(),
  /** 范围行子行元数据：null=单寄存器行或老数据；范围行长度=registerCount，缺省补默认 */
  registers: z
    .array(
      z.object({
        name: z.string(),
        comment: z.string(),
        dataType: dataTypeSchema,
      }),
    )
    .nullable()
    .default(null),
  /** 位级注释：外层长度=registerCount，内层长度 16（下标=bit 号）；缺省 null（老数据） */
  bitComments: z.array(z.array(z.string()).nullable()).nullable().default(null),
  /** 位级名称：结构同 bitComments；缺省 null。 */
  bitNames: z.array(z.array(z.string()).nullable()).nullable().default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const sheetSchema = z.object({
  sheetId: z.string(),
  name: z.string(),
  /** 表类型：核心 "holding-register" / "coil" / "discrete-input" / "input-register"，
   * 或插件类型 "<pluginId>:<tableTypeId>"；老数据由迁移补齐。 */
  type: z
    .union([
      z.literal("holding-register"),
      z.literal("coil"),
      z.literal("discrete-input"),
      z.literal("input-register"),
      z
        .string()
        .regex(
          /^[^:]+:[^:]+$/,
          "sheet type must be a core type or <pluginId>:<tableTypeId>",
        ),
    ])
    .default("holding-register"),
  order: z.number().int(),
  /** 打开/关闭状态：关闭的表仍在工作区中（侧边栏保留），仅从页签栏隐藏；老数据缺省补 true，无需迁移 */
  open: z.boolean().default(true),
  rows: z.array(rowSchema),
  /** Register 地址列进制：默认 DEC；老数据缺省时补默认值，无需迁移 */
  registerRadix: z.enum(["dec", "hex"]).default("dec"),
  /** 各列拖拽宽度（随表持久化）；老数据缺省补默认 {}，无需迁移 */
  columnWidths: z
    .record(z.string(), z.number().finite().positive())
    .default({}),
  /** 各列拖拽后的排列顺序（随表持久化）；老数据缺省补 null（默认顺序），无需迁移 */
  columnOrder: z.array(z.string()).nullable().default(null),
  /** Slave Address（每表独立，随表持久化）；老数据缺省补默认 1，无需迁移 */
  slaveAddress: z
    .number()
    .int()
    .min(0)
    .max(255)
    .default(
      1,
    ) /** 写后回读配置（每表独立，随工作区持久化）；老数据由 v1→v2 迁移补齐，缺省再补默认关闭 */,
  writeVerify: z
    .object({
      mode: z.enum(["off", "immediate", "delayed"]),
      delayMs: z.number().nullable(),
    })
    .default({ mode: "off", delayMs: null }),
  /** 表级地址变换配置（每表独立，随工作区持久化）；老数据由 v5→v6 迁移补齐，缺省再补 null */
  addressTransform: z
    .object({
      transformId: z.string().min(1),
      enabled: z.boolean(),
    })
    .nullable()
    .default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/**
 * RTU 连接配置完整持久化（确认）：除串口/端口选择外，波特率、数据位、
 * 停止位、校验位、流控等端口参数与超时、重试、请求间隔、Address Adjust
 * 均随工作区持久化（从站地址已按表独立设置，见 sheetSchema.slaveAddress）。
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
  recentPortHint: z.string().nullable().default(null),
});

/**
 * TCP 连接配置持久化（确认：入 workspace，恢复 host/port/unitId/超时/重试；
 * 保持离线、不自动连接）。unitId 0~255 默认 0；autoReconnect 为 P1 能力默认 false（UI 灰显）。
 */
const tcpProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  protocol: z.literal("tcp"),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  unitId: z.number().int().min(0).max(255).default(defaultConfig.tcp.unitId),
  connectTimeoutMs: z.number().int().min(0),
  requestTimeoutMs: z.number().int().min(0),
  retryCount: z.number().int().min(0).max(10),
  autoReconnect: z.boolean().default(defaultConfig.tcp.autoReconnect),
});

const pluginStateSchema = z.object({
  pluginId: z.string(),
  enabled: z.boolean(),
  settings: z.record(z.string(), z.unknown()),
  lastKnownVersion: z.string().nullable(),
  permissions: z.array(z.string()),
});

const workspaceObjectSchema = z.object({
  schemaVersion: z.number().int(),
  workspaceId: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  activeSheetId: z.string().nullable(),
  sheets: z.array(sheetSchema),
  // Older workspaces derive their counters from sheet names in the UI.
  sheetNameCounters: z
    .record(
      z.string(),
      z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    )
    .default({}),
  connectionProfiles: z.array(
    z.discriminatedUnion("protocol", [rtuProfileSchema, tcpProfileSchema]),
  ),
  activeConnectionProfileId: z.string().nullable(),
  pollingSettings: z.object({
    enabledBehavior: z.literal("manual"),
    maxPendingPollingTasks: z.number().int(),
  }),
  panelLayout: z.object({
    sidebarCollapsed: z.boolean(),
    /** 侧边栏展开态宽度（px 可拖宽；老数据缺省补默认，无需迁移）。 */
    sidebarWidth: z.number().default(DEFAULT_SIDEBAR_WIDTH),
    bottomPanelCollapsed: z.boolean(),
    bottomPanelHeight: z.number(),
    activeBottomTab: z.string(),
  }),
  preferences: z.object({
    theme: z.enum(["light", "dark"]),
    /** 界面语言：默认 en-US；老数据缺省时补默认值，无需迁移。 */
    language: z.enum(["en-US", "zh-CN"]).default("en-US"),
    /** 所选主题色预设：null=内置 Ant Design 默认蓝；插件色 = `<pluginId>:<colorId>`；老数据缺省补 null。 */
    themePrimary: z.string().nullable().default(null),
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

// Reject excessive expansion before Zod clones the workspace and nested arrays.
export const workspaceSchema = z
  .unknown()
  .superRefine((input, context) => {
    const expansion = validateWorkspaceExpansion(input);
    if (!expansion.ok) {
      context.addIssue({ code: "custom", message: expansion.error.technicalMessage });
    }
  })
  .pipe(workspaceObjectSchema);

export type WorkspaceData = z.infer<typeof workspaceSchema>;

/** 保存 Worker 返回的已校验快照：对象供 IndexedDB 写入，字符串供文件/IPC 写入。 */
export interface WorkspaceSerialization {
  serialized: string;
  data: WorkspaceData;
}

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

/** 把完整领域对象降为持久化快照；不执行 Schema 校验。 */
function workspaceDataFromWorkspace(workspace: Workspace): WorkspaceData {
  const data: WorkspaceData = {
    ...workspace,
    sheetNameCounters: workspace.sheetNameCounters ?? {},
    sheets: workspace.sheets.map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row) => ({
        ...row,
        // Keep the stored shape compatible without saving session selections.
        pollingEnabled: false,
        traceEnabled: false,
        addressValue: row.addressValue?.value ?? null,
        registerValues: row.registerValues?.map((value) => value.value) ?? null,
      })),
    })),
  };
  return data;
}

/**
 * 生成经完整当前 Schema 校验的持久化快照。
 *
 * 自动保存只调用该函数一次即可得到文件所需字符串和 IndexedDB 所需对象，避免
 * JSON.stringify/parse 与 Schema 校验被重复执行。
 */
export function serializeWorkspaceSnapshot(
  workspace: Workspace,
): Result<WorkspaceSerialization> {
  const validated = workspaceSchema.safeParse(
    workspaceDataFromWorkspace(workspace),
  );
  if (!validated.success) {
    return fail(schemaInvalidError(validated.error.message));
  }
  return ok({
    serialized: JSON.stringify(validated.data),
    data: validated.data,
  });
}

/** 序列化工作区为 JSON 字符串（领域对象 -> 存储形态）。 */
export function serializeWorkspace(workspace: Workspace): string {
  const serialized = serializeWorkspaceSnapshot(workspace);
  if (!serialized.ok) throw new Error(serialized.error.technicalMessage);
  return serialized.value.serialized;
}

/** 执行迁移和 Schema 校验，返回可结构化克隆的持久化数据。 */
export function parseWorkspaceData(input: unknown): Result<WorkspaceData> {
  // 迁移框架（docs/AGENTS.md §19.6）：先按版本链迁移再校验。v1→v2：
  // 写后回读配置从 workspace 全局 readVerifySettings 迁移到各 sheet.writeVerify。
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return fail(schemaInvalidError("workspace data must be an object"));
  }
  const migrated = migrateData(input as Record<string, unknown>, migrations);
  if (!migrated.ok) return migrated;
  const validated = workspaceSchema.safeParse(migrated.value);
  if (!validated.success) {
    return fail(schemaInvalidError(validated.error.message));
  }
  return ok(validated.data);
}

/** 解析并校验持久化数据，重建领域对象（受控工厂恢复值对象）。 */
export function parseWorkspace(input: unknown): Result<Workspace> {
  const data = parseWorkspaceData(input);
  if (!data.ok) return data;
  return ok(hydrateWorkspaceData(data.value));
}

/** 当前 schema 版本常量（与 domain 保持一致）。 */
export const currentWorkspaceSchemaVersion = workspaceSchemaVersion;
