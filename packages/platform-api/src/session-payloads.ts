/**
 * RTU 会话 RPC 载荷（HostMessage v1，VSCode 端接线，docs/TECH_DESIGN.md §22/§23）。
 *
 * 跨边界传输的领域对象用「可序列化投影」：Zod schema 产出纯 JSON 载荷类型，
 * 配合 toXxxPayload / xxxFromPayload 在边界往返。品牌化 ID（ConnectionProfileId /
 * RowId）在 JSON 往返后丢失名义类型，由 FromPayload 重建（结构化收窄，非蒙混）。
 *
 * 本文件只定义领域对象投影，不包含 Envelope / kind 白名单（见 host-message.ts），
 * 不反向依赖 host-message.ts，避免循环导入。
 */
import { z } from "zod";
import {
  RawRegisterValue,
  RegisterAddress,
  type ConnectionProfileId,
  type ReadVerifySettings,
  type RegisterRow,
  type RowId,
  type RtuConnectionProfile,
  type TcpConnectionProfile,
} from "@mamep2026/domain";
import type {
  BatchReadRow,
  BatchReadSummary,
  CommunicationLogEvent,
  WriteOutcome,
} from "@mamep2026/communication";
import type { ApplicationMessage } from "@mamep2026/logging";

// ---- 字节 <-> hex（RPC 载荷紧凑传输；显示格式化仍用 communication formatBytesHex）----

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ---- RtuConnectionProfile ----

export const rtuConnectionProfilePayloadSchema = z.object({
  id: z.string(),
  name: z.string(),
  protocol: z.literal("rtu"),
  baudRate: z.number(),
  dataBits: z.union([z.literal(7), z.literal(8)]),
  stopBits: z.union([z.literal(1), z.literal(2)]),
  parity: z.enum(["none", "even", "odd"]),
  flowControl: z.enum(["off", "rts-cts", "xon-xoff"]),
  requestTimeoutMs: z.number(),
  retryCount: z.number(),
  recentPortHint: z.string().nullable(),
});
export type RtuConnectionProfilePayload = z.infer<
  typeof rtuConnectionProfilePayloadSchema
>;

export function toRtuConnectionProfilePayload(
  profile: RtuConnectionProfile,
): RtuConnectionProfilePayload {
  return { ...profile };
}

export function rtuConnectionProfileFromPayload(
  payload: RtuConnectionProfilePayload,
): RtuConnectionProfile {
  return { ...payload, id: payload.id as ConnectionProfileId };
}

// ---- TcpConnectionProfile（2026-08-23 TCP 接线）----

export const tcpConnectionProfilePayloadSchema = z.object({
  id: z.string(),
  name: z.string(),
  protocol: z.literal("tcp"),
  host: z.string(),
  port: z.number(),
  unitId: z.number(),
  connectTimeoutMs: z.number(),
  requestTimeoutMs: z.number(),
  retryCount: z.number(),
  autoReconnect: z.boolean(),
});
export type TcpConnectionProfilePayload = z.infer<
  typeof tcpConnectionProfilePayloadSchema
>;

export function toTcpConnectionProfilePayload(
  profile: TcpConnectionProfile,
): TcpConnectionProfilePayload {
  return { ...profile };
}

export function tcpConnectionProfileFromPayload(
  payload: TcpConnectionProfilePayload,
): TcpConnectionProfile {
  return { ...payload, id: payload.id as ConnectionProfileId };
}

/** session-tcp-connect 载荷（2026-08-23）：TCP 无串口句柄，profile 即完整连接参数。 */
export const sessionTcpConnectPayloadSchema = z.object({
  profile: tcpConnectionProfilePayloadSchema,
});
export type SessionTcpConnectPayload = z.infer<
  typeof sessionTcpConnectPayloadSchema
>;

// ---- RegisterRow ----

/** dataType（ADR-043 E-3）：开放字符串，承载内置 + 插件类型。 */
const dataTypeEnumSchema = z.string().min(1);

export const registerAddressPayloadSchema = z.object({
  value: z.number(),
});
export type RegisterAddressPayload = z.infer<
  typeof registerAddressPayloadSchema
>;

/** 范围行子行元数据（2026-08-27）：每寄存器独立 name/comment/dataType。 */
export const registerSubRowMetaPayloadSchema = z.object({
  name: z.string(),
  comment: z.string(),
  dataType: dataTypeEnumSchema,
});
export type RegisterSubRowMetaPayload = z.infer<
  typeof registerSubRowMetaPayloadSchema
>;

export const registerRowPayloadSchema = z.object({
  rowId: z.string(),
  order: z.number(),
  name: z.string(),
  comment: z.string(),
  addressDraft: z.string(),
  addressValue: registerAddressPayloadSchema.nullable(),
  /** 覆盖的连续寄存器数（ADR-030）：1=单寄存器；范围行 >1 */
  registerCount: z.number().int().min(1).default(1),
  dataType: dataTypeEnumSchema,
  pollingEnabled: z.boolean(),
  traceEnabled: z.boolean(),
  cellText: z.string(),
  /** 各寄存器原始值（ADR-030，替代 lastKnownRawValue）：null=未读 */
  registerValues: z.array(z.number().int().min(0).max(65535)).nullable(),
  /** 范围行子行元数据（2026-08-27）：null=单寄存器行或老数据 */
  registers: z
    .array(registerSubRowMetaPayloadSchema)
    .nullable()
    .default(null),
  /** 位级注释（ADR-052，2026-09-11）：外层长度=registerCount，内层长度 16（下标=bit 号） */
  bitComments: z
    .array(z.array(z.string()).nullable())
    .nullable()
    .default(null),
  /** 位级名称（ADR-052 需求追加）：结构同 bitComments */
  bitNames: z
    .array(z.array(z.string()).nullable())
    .nullable()
    .default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type RegisterRowPayload = z.infer<typeof registerRowPayloadSchema>;

export function toRegisterRowPayload(row: RegisterRow): RegisterRowPayload {
  return {
    ...row,
    addressValue:
      row.addressValue === null ? null : { value: row.addressValue.value },
    registerValues:
      row.registerValues?.map((value) => value.value) ?? null,
    registers: row.registers ?? null,
    bitComments: row.bitComments ?? null,
    bitNames: row.bitNames ?? null,
  };
}

export function registerRowFromPayload(
  payload: RegisterRowPayload,
): RegisterRow {
  const address =
    payload.addressValue === null
      ? null
      : RegisterAddress.create(payload.addressValue.value);
  const registerValues =
    payload.registerValues === null
      ? null
      : payload.registerValues.map((value) => {
          const created = RawRegisterValue.create(value);
          return created.ok ? created.value : null;
        });
  return {
    ...payload,
    rowId: payload.rowId as RowId,
    addressValue:
      address === null ? null : address.ok ? address.value : null,
    registerValues:
      registerValues === null
        ? null
        : registerValues.filter(
            (value): value is RawRegisterValue => value !== null,
          ),
    registers: payload.registers ?? null,
    bitComments: payload.bitComments ?? null,
    bitNames: payload.bitNames ?? null,
  };
}

// ---- 写后回读配置（每表独立，2026-08-26）----

export const readVerifySettingsPayloadSchema = z.object({
  mode: z.enum(["off", "immediate", "delayed"]),
  delayMs: z.number().nullable(),
});
export type ReadVerifySettingsPayload = z.infer<
  typeof readVerifySettingsPayloadSchema
>;

export function toReadVerifySettingsPayload(
  settings: ReadVerifySettings,
): ReadVerifySettingsPayload {
  return { ...settings };
}

export function readVerifySettingsFromPayload(
  payload: ReadVerifySettingsPayload,
): ReadVerifySettings {
  return { ...payload };
}

/** session-write-row 请求载荷：writeVerify 缺省=不回读（保持既有行为）。 */
export const sessionWriteRowPayloadSchema = z.object({
  row: registerRowPayloadSchema,
  writeVerify: readVerifySettingsPayloadSchema.optional(),
});
export type SessionWriteRowPayload = z.infer<
  typeof sessionWriteRowPayloadSchema
>;

// ---- 批量读取 ----

export const batchReadRowPayloadSchema = z.object({
  key: z.string(),
  /** null 表示地址为空或非法，将被跳过。 */
  address: z.number().nullable(),
  /** 覆盖的连续寄存器数（ADR-030）：缺省/1=单寄存器。 */
  quantity: z.number().int().min(1).optional(),
});
export type BatchReadRowPayload = z.infer<typeof batchReadRowPayloadSchema>;

export const batchReadSummaryPayloadSchema = z.object({
  batchId: z.string(),
  totalRows: z.number(),
  eligibleRows: z.number(),
  successCount: z.number(),
  failureCount: z.number(),
  skippedCount: z.number(),
  cancelledCount: z.number(),
  startedAt: z.number(),
  completedAt: z.number(),
  durationMs: z.number(),
});
export type BatchReadSummaryPayload = z.infer<
  typeof batchReadSummaryPayloadSchema
>;

export function toBatchReadSummaryPayload(
  summary: BatchReadSummary,
): BatchReadSummaryPayload {
  return { ...summary };
}

export function toBatchReadRowPayload(row: BatchReadRow): BatchReadRowPayload {
  return { ...row };
}

// ---- 批量读取请求（远程路径 batchId 由渲染端生成，ADR-025）----

/** session-batch-read 请求载荷：batchId 供 session-batch-cancel 关联取消。 */
export const sessionBatchReadPayloadSchema = z.object({
  batchId: z.string().min(1),
  rows: z.array(batchReadRowPayloadSchema),
});
export type SessionBatchReadPayload = z.infer<
  typeof sessionBatchReadPayloadSchema
>;

/** session-batch-cancel 请求载荷：按 batchId 取消活动批任务（未知 id 为安全 no-op）。 */
export const sessionBatchCancelPayloadSchema = z.object({
  batchId: z.string().min(1),
});
export type SessionBatchCancelPayload = z.infer<
  typeof sessionBatchCancelPayloadSchema
>;

let batchSeq = 0;
/** 生成跨边界批任务唯一 batchId（渲染端创建 BatchReadHandle 时使用，ADR-025）。 */
export function createBatchId(): string {
  batchSeq += 1;
  const time = Date.now().toString(36);
  const seq = batchSeq.toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `batch-${time}-${seq}-${rand}`;
}

// ---- WriteOutcome ----

/**
 * 写入结果投影（docs/TECH_DESIGN.md §15.3、docs/AGENTS.md §18.2，2026-08-26）：
 * 写后回读扩展为 5 种 kind 判别联合，与 communication WriteOutcome 一一对应。
 * 多寄存器（ADR-030，2026-08-27）：verify 结果携带 readValues/expectedValues 数组。
 */
export const writeOutcomePayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("write-succeeded-no-verify") }),
  z.object({
    kind: z.literal("write-succeeded-verify-matched"),
    readValues: z.array(z.number()),
  }),
  z.object({
    kind: z.literal("write-succeeded-verify-mismatched"),
    expectedValues: z.array(z.number()),
    readValues: z.array(z.number()),
  }),
  z.object({
    kind: z.literal("write-succeeded-verify-failed"),
    errorCode: z.string(),
    userMessageKey: z.string(),
  }),
  z.object({ kind: z.literal("cancelled-before-verify") }),
]);
export type WriteOutcomePayload = z.infer<typeof writeOutcomePayloadSchema>;

export function toWriteOutcomePayload(
  outcome: WriteOutcome,
): WriteOutcomePayload {
  return { ...outcome };
}

// ---- CommunicationLogEvent（bytes 转 hex）----

export const commLogEventPayloadSchema = z.object({
  timestamp: z.number(),
  direction: z.enum(["request", "response"]),
  bytesHex: z.string(),
  /** 协议：rtu / tcp / codecId（2026-08-23 TCP 接线；2026-08-31 ADR-040 开放为 codecId）。 */
  protocol: z.string(),
  slaveAddress: z.number().nullable(),
  functionCode: z.number().nullable(),
  userAddress: z.number().nullable(),
  sentAddress: z.number().nullable(),
  quantity: z.number().nullable(),
  attempt: z.number(),
  status: z.enum([
    "success",
    "failure",
    "timeout",
    "cancelled",
    "discarded",
  ]),
  errorCode: z.string().nullable(),
  exceptionCode: z.number().nullable(),
  source: z.enum([
    "manual-read",
    "manual-write",
    "write-verify",
    "batch-read",
    "polling",
    "trace",
    "plugin",
    "connection-control",
  ]),
  /** 发起插件 id（source="plugin" 时非 null；ADR-039）。 */
  pluginId: z.string().nullable(),
  durationMs: z.number().nullable(),
});
export type CommLogEventPayload = z.infer<typeof commLogEventPayloadSchema>;

export function toCommLogEventPayload(
  event: CommunicationLogEvent,
): CommLogEventPayload {
  return { ...event, bytesHex: bytesToHex(event.bytes) };
}

export function commLogEventFromPayload(
  payload: CommLogEventPayload,
): CommunicationLogEvent {
  const { bytesHex, ...rest } = payload;
  return { ...rest, bytes: hexToBytes(bytesHex) };
}

// ---- TraceSample ----

export const traceSamplePayloadSchema = z.object({
  key: z.string(),
  sequence: z.number(),
  rawValue: z.number(),
  timestamp: z.number(),
});
export type TraceSamplePayload = z.infer<typeof traceSamplePayloadSchema>;

// ---- ApplicationMessage ----

export const appMessagePayloadSchema = z.object({
  timestamp: z.number(),
  level: z.enum(["info", "warning", "error"]),
  messageKey: z.string(),
  params: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional(),
  detail: z.string().nullable(),
});
export type AppMessagePayload = z.infer<typeof appMessagePayloadSchema>;

export function toAppMessagePayload(
  message: ApplicationMessage,
): AppMessagePayload {
  return { ...message };
}

// ---- 插件存储（plugin-store-load / plugin-store-save，2026-08-30，ADR-038；v2 2026-08-31，ADR-039）----
// 已安装插件（manifest + 启用状态）为应用级资产，三端经 HostMessage v1 往返：
// 浏览器直连 IndexedDB（不跨边界）；Electron 主进程 userData plugins.json；
// VSCode Extension Host globalState。manifest 投影与 @mamep2026/plugin-api 的
// PluginManifest v2 结构一致（结构收窄，非蒙混），由消费层做 FromPayload 重建。

export const pluginManifestPayloadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  apiVersion: z.string().min(1),
  description: z.string(),
  author: z.string().optional(),
  license: z.string().optional(),
  entry: z
    .object({
      web: z.string().min(1).optional(),
      node: z.string().min(1).optional(),
    })
    .optional(),
  requiredCapabilities: z.array(z.string()).default([]),
  platform: z.object({
    web: z.boolean(),
    node: z.boolean(),
  }),
  permissions: z
    .array(
      z.enum([
        "communication",
        "device-write",
        "workspace-read",
        "workspace-write",
        "file-read",
        "file-write",
        "network",
        "ui-contribution",
        "theme",
      ]),
    )
    .default([]),
  contributes: z.record(z.string(), z.unknown()).default({}),
});
export type PluginManifestPayload = z.infer<typeof pluginManifestPayloadSchema>;

export const storedPluginPayloadSchema = z.object({
  manifest: pluginManifestPayloadSchema,
  enabled: z.boolean(),
});
export type StoredPluginPayload = z.infer<typeof storedPluginPayloadSchema>;

export const pluginStoreDataPayloadSchema = z.object({
  schemaVersion: z.literal(3),
  plugins: z.array(storedPluginPayloadSchema),
  // 随包插件一次性安装标记（2026-09-02 插件外部化）：与 plugin-api PluginStoreData v3 对齐。
  seeded: z.boolean(),
});
export type PluginStoreDataPayload = z.infer<typeof pluginStoreDataPayloadSchema>;

/** plugin-store-load 响应载荷（结构同 PluginStoreData，空 store 返回 { schemaVersion:3, plugins:[], seeded:false }）。 */
export const pluginStoreDataResponseSchema = pluginStoreDataPayloadSchema;
export type PluginStoreDataResponse = z.infer<typeof pluginStoreDataResponseSchema>;

// ---- 插件运行时桥（2026-08-31，ADR-039：Phase A 契约一次定型，宿主侧返回能力错误）----

/** plugin-runtime-load 请求载荷：请求宿主加载 Host 插件实例（Phase A 宿主返回能力错误）。 */
export const pluginRuntimeLoadPayloadSchema = z.object({
  pluginId: z.string().min(1),
});
export type PluginRuntimeLoadPayload = z.infer<
  typeof pluginRuntimeLoadPayloadSchema
>;

/** plugin-runtime-unload 请求载荷：卸载 Host 插件实例。 */
export const pluginRuntimeUnloadPayloadSchema = z.object({
  pluginId: z.string().min(1),
});
export type PluginRuntimeUnloadPayload = z.infer<
  typeof pluginRuntimeUnloadPayloadSchema
>;

/** plugin-rpc 请求载荷：渲染 ↔ 宿主通用插件调用桥（method/args 由插件自定）。 */
export const pluginRpcPayloadSchema = z.object({
  pluginId: z.string().min(1),
  method: z.string().min(1),
  args: z.array(z.unknown()).default([]),
});
export type PluginRpcPayload = z.infer<typeof pluginRpcPayloadSchema>;

/** plugin-contribution-query 请求载荷：可选按贡献点 ID 过滤查询已装配贡献点。 */
export const pluginContributionQueryPayloadSchema = z.object({
  pointId: z.string().optional(),
});
export type PluginContributionQueryPayload = z.infer<
  typeof pluginContributionQueryPayloadSchema
>;

/** plugin-contribution-query 响应载荷：已装配贡献点摘要（Phase A 宿主返回能力错误）。 */
export const pluginContributionQueryResponseSchema = z.object({
  points: z.array(
    z.object({
      pluginId: z.string(),
      pointId: z.string(),
      payload: z.unknown(),
    }),
  ),
});
export type PluginContributionQueryResponse = z.infer<
  typeof pluginContributionQueryResponseSchema
>;

/** plugin-event 事件载荷：宿主 → 渲染的插件事件订阅转发。 */
export const pluginEventPayloadSchema = z.object({
  pluginId: z.string().min(1),
  name: z.string().min(1),
  payload: z.unknown().optional(),
});
export type PluginEventPayload = z.infer<typeof pluginEventPayloadSchema>;
