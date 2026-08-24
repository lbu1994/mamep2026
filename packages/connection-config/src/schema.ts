/**
 * 连接对象配置文件（config/connections.json）Schema 与纯函数（ADR-023）。
 *
 * 定位：
 * - 配置文件是「外部连接对象定义」：真实设备（真实 COM 口 / 真实 Modbus TCP 端口）的
 *   连接参数以 JSON 形式集中管理，供应用 UI 载入预填、供测试/验证脚本读取，消除
 *   COM4/COM5/127.0.0.1:1502 等硬编码。
 * - 与 `connectionProfiles`（IndexedDB 持久化）的关系：配置文件作为「默认值来源 + 导入
 *   预填」，载入后合并进 `connectionProfiles[0]`，不破坏现有持久化边界（ADR-017 串口选择
 *   仍是运行时状态——但配置文件明确包含串口名 port，作为外部连接对象的定义字段）。
 * - 本包只依赖 @mamep2026/domain 与 zod，无平台依赖：浏览器（导入/URL）、Electron/VSCode
 *   （文件系统）、scripts（Node）三端复用同一套 schema 与解析。
 *
 * 生效时机（2026-08-24 确认）：重连/重启时重新读取（打开连接设置时加载），无热更新。
 */
import {
  createMamepError,
  defaultConfig,
  fail,
  ok,
  type AddressAdjustMode,
  type ConnectionProfileId,
  type FlowControl,
  type MamepError,
  type Parity,
  type Result,
  type RtuConnectionProfile,
  type TcpConnectionProfile,
} from "@mamep2026/domain";
import { z } from "zod";

/** 配置文件格式版本（变更不兼容时递增；兼容变更直接在字段上补默认值）。 */
export const CONNECTION_CONFIG_SCHEMA_VERSION = 1 as const;

/** RTU 连接对象（配置文件版）。port 为串口名——外部连接对象定义字段，区别于持久化边界。 */
export const rtuConnectionConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  protocol: z.literal("rtu"),
  /** 串口名（如 COM4 / /dev/ttyUSB0）。配置文件特有字段。 */
  port: z.string().min(1),
  baudRate: z.number().int().positive().default(defaultConfig.rtu.baudRate),
  dataBits: z
    .union([z.literal(7), z.literal(8)])
    .default(defaultConfig.rtu.dataBits as 7 | 8),
  stopBits: z
    .union([z.literal(1), z.literal(2)])
    .default(defaultConfig.rtu.stopBits as 1 | 2),
  parity: z
    .enum(["none", "even", "odd"])
    .default(defaultConfig.rtu.parity as Parity),
  flowControl: z
    .enum(["off", "rts-cts", "xon-xoff"])
    .default(defaultConfig.rtu.flowControl as FlowControl),
  /** 该连接对象的默认从站地址（0~255，默认 1；载入时预填当前表从站地址，不改「按表独立」模型）。 */
  slaveAddress: z
    .number()
    .int()
    .min(0)
    .max(255)
    .default(defaultConfig.registerTable.slaveAddress),
  requestTimeoutMs: z
    .number()
    .int()
    .min(0)
    .default(defaultConfig.rtu.requestTimeoutMs),
  retryCount: z
    .number()
    .int()
    .min(0)
    .max(10)
    .default(defaultConfig.rtu.retryCount),
  interRequestDelayMs: z
    .number()
    .int()
    .min(0)
    .default(defaultConfig.rtu.interRequestDelayMs),
  addressAdjust: z
    .enum(["off", "on"])
    .default(defaultConfig.rtu.addressAdjust as AddressAdjustMode),
});

/** TCP 连接对象（配置文件版）。 */
export const tcpConnectionConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  protocol: z.literal("tcp"),
  /** host 视为不透明字符串原样传递（§34.3.4 路径/主机名不解析原则）。 */
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  unitId: z
    .number()
    .int()
    .min(0)
    .max(255)
    .default(defaultConfig.tcp.unitId),
  connectTimeoutMs: z
    .number()
    .int()
    .min(0)
    .default(defaultConfig.tcp.connectTimeoutMs),
  requestTimeoutMs: z
    .number()
    .int()
    .min(0)
    .default(defaultConfig.tcp.requestTimeoutMs),
  retryCount: z
    .number()
    .int()
    .min(0)
    .max(10)
    .default(defaultConfig.tcp.retryCount),
  autoReconnect: z.boolean().default(defaultConfig.tcp.autoReconnect),
  interRequestDelayMs: z
    .number()
    .int()
    .min(0)
    .default(defaultConfig.tcp.interRequestDelayMs),
});

/** 连接对象判别联合（按 protocol）。 */
export const connectionConfigSchema = z.discriminatedUnion("protocol", [
  rtuConnectionConfigSchema,
  tcpConnectionConfigSchema,
]);

/** 完整配置文件。 */
export const connectionConfigFileSchema = z.object({
  schemaVersion: z.literal(CONNECTION_CONFIG_SCHEMA_VERSION),
  /** 默认选中的连接对象 id（仅作「从配置载入」的默认选中项，不与 UI 当前连接强制联动）。 */
  activeConnectionId: z.string().nullable().default(null),
  connections: z.array(connectionConfigSchema).default([]),
});

export type RtuConnectionConfig = z.infer<typeof rtuConnectionConfigSchema>;
export type TcpConnectionConfig = z.infer<typeof tcpConnectionConfigSchema>;
export type ConnectionConfigObject = z.infer<typeof connectionConfigSchema>;
export type ConnectionConfigFile = z.infer<typeof connectionConfigFileSchema>;

/** 默认（空）配置文件结构。 */
export function createDefaultConnectionConfig(): ConnectionConfigFile {
  return {
    schemaVersion: CONNECTION_CONFIG_SCHEMA_VERSION,
    activeConnectionId: null,
    connections: [],
  };
}

/** 解析配置文件 JSON 文本；校验失败返回结构化 MamepError（category: validation）。 */
export function parseConnectionConfig(json: string): Result<ConnectionConfigFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    return fail(
      createMamepError({
        code: "CONNECTION_CONFIG_INVALID_JSON",
        category: "validation",
        userMessageKey: "connection.configInvalidJson",
        technicalMessage: `connection config is not valid JSON: ${causeToString(cause)}`,
        cause,
      }),
    );
  }
  const parsed = connectionConfigFileSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(
      createMamepError({
        code: "CONNECTION_CONFIG_INVALID",
        category: "validation",
        userMessageKey: "connection.configInvalid",
        technicalMessage: `connection config validation failed: ${parsed.error.message}`,
      }),
    );
  }
  return ok(parsed.data);
}

/** 按 id 解析连接对象；未指定或不存在返回 null。 */
export function resolveConnection(
  configFile: ConnectionConfigFile,
  connectionId: string | null,
): ConnectionConfigObject | null {
  if (connectionId === null) return null;
  return configFile.connections.find((connection) => connection.id === connectionId) ?? null;
}

/** 默认选中连接对象：优先 activeConnectionId，回退第一个连接。 */
export function resolveDefaultConnection(
  configFile: ConnectionConfigFile,
): ConnectionConfigObject | null {
  const active = resolveConnection(configFile, configFile.activeConnectionId);
  if (active !== null) return active;
  return configFile.connections[0] ?? null;
}

/** 连接对象 → 领域连接配置（供会话层 / 持久化合并消费）。
 * id 复用配置对象 id（品牌化断言，与 parseWorkspace 恢复值对象的做法一致）；
 * RTU 的 port 写入 recentPortHint（仅作提示，不用于自动连接——§19.3）。 */
export function connectionToProfile(
  connection: ConnectionConfigObject,
): RtuConnectionProfile | TcpConnectionProfile {
  if (connection.protocol === "rtu") {
    return {
      id: connection.id as ConnectionProfileId,
      name: connection.name,
      protocol: "rtu",
      baudRate: connection.baudRate,
      dataBits: connection.dataBits,
      stopBits: connection.stopBits,
      parity: connection.parity,
      flowControl: connection.flowControl,
      requestTimeoutMs: connection.requestTimeoutMs,
      retryCount: connection.retryCount,
      interRequestDelayMs: connection.interRequestDelayMs,
      addressAdjust: connection.addressAdjust,
      recentPortHint: connection.port,
    };
  }
  return {
    id: connection.id as ConnectionProfileId,
    name: connection.name,
    protocol: "tcp",
    host: connection.host,
    port: connection.port,
    unitId: connection.unitId,
    connectTimeoutMs: connection.connectTimeoutMs,
    requestTimeoutMs: connection.requestTimeoutMs,
    retryCount: connection.retryCount,
    autoReconnect: connection.autoReconnect,
    interRequestDelayMs: connection.interRequestDelayMs,
  };
}

function causeToString(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** 构造「无法加载配置文件」错误（文件不存在 / 不可读时由平台侧使用）。 */
export function connectionConfigLoadError(
  path: string,
  cause: unknown,
): MamepError {
  return createMamepError({
    code: "CONNECTION_CONFIG_LOAD_FAILED",
    category: "persistence",
    userMessageKey: "connection.configLoadFailed",
    technicalMessage: `failed to load connection config from ${path}: ${causeToString(cause)}`,
    cause,
  });
}
