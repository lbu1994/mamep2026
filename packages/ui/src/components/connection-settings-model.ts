import {
  defaultConfig,
  type RtuConnectionProfile,
  type TcpConnectionProfile,
} from "@mamep2026/domain";
import { z } from "zod";

/** RTU 超时固定档位（步进 5ms，5..100 共 20 项；2026-09-06 与旧软件一致，无自定义输入）。 */
export const RTU_TIMEOUT_OPTIONS = Array.from(
  { length: 20 },
  (_, i) => 5 * (i + 1),
);

/** 连接设置表单（RTU 与 TCP 字段共存；UI 按 protocol 互斥展示）。
 * host 为默认空串、经 superRefine 仅 TCP 协议下要求非空——避免 RTU 提交被空的
 * host 卡住校验（2026-08-23 e2e 回归修复）。 */
export const settingsSchema = z
  .object({
    protocol: z.enum(["rtu", "tcp"]),
    // ---- RTU ----
    baudRate: z.number().int().positive(),
    dataBits: z.union([z.literal(7), z.literal(8)]),
    stopBits: z.union([z.literal(1), z.literal(2)]),
    parity: z.enum(["none", "even", "odd"]),
    flowControl: z.enum(["off", "rts-cts"]),
    rxDelay: z.number().int().min(0).max(5000),
    rtuTimeout: z.number().int().min(5).max(100),
    retry: z.number().int().min(0).max(10),
    // ---- TCP（保持必填类型；非空校验仅 TCP 协议下经 superRefine 生效；超时字段独立）----
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    unitId: z.number().int().min(0).max(255),
    tcpTimeout: z.number().int().min(50).max(60000),
    autoReconnect: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.protocol === "tcp" && values.host.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["host"],
        message: "errors.tcpHostInvalid",
      });
    }
  });

export type ConnectionSettingsValues = z.infer<typeof settingsSchema>;

/** RTU 随工作区持久化的连接设置子集（2026-08-17 确认，2026-08-23 加 protocol 判别）。 */
export const rtuPersistedSettingsSchema = z.object({
  protocol: z.literal("rtu"),
  baudRate: z.number().int().positive(),
  dataBits: z.union([z.literal(7), z.literal(8)]),
  stopBits: z.union([z.literal(1), z.literal(2)]),
  parity: z.enum(["none", "even", "odd"]),
  flowControl: z.enum(["off", "rts-cts"]),
  requestTimeoutMs: z.number().int().min(5).max(100),
  retryCount: z.number().int().min(0).max(10),
  interRequestDelayMs: z.number().int().min(0).max(5000),
});

/** TCP 随工作区持久化的连接设置子集（2026-08-23 两端 TCP 接线：host/port/unitId/超时/重试；2026-08-30 增 autoReconnect）。 */
export const tcpPersistedSettingsSchema = z.object({
  protocol: z.literal("tcp"),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  unitId: z.number().int().min(0).max(255),
  requestTimeoutMs: z.number().int().min(50).max(60000),
  retryCount: z.number().int().min(0).max(10),
  interRequestDelayMs: z.number().int().min(0).max(5000),
  autoReconnect: z.boolean(),
});

export const persistedSettingsSchema = z.discriminatedUnion("protocol", [
  rtuPersistedSettingsSchema,
  tcpPersistedSettingsSchema,
]);

export type PersistedConnectionSettings = z.infer<
  typeof persistedSettingsSchema
>;

/** 按表单协议构建连接配置（base 为对应协议的工作区 profile）。 */
export function toProfile(
  values: ConnectionSettingsValues,
  base: RtuConnectionProfile | TcpConnectionProfile,
): RtuConnectionProfile | TcpConnectionProfile {
  if (values.protocol === "tcp") {
    return {
      ...(base as TcpConnectionProfile),
      host: values.host,
      port: values.port,
      unitId: values.unitId,
      requestTimeoutMs: values.tcpTimeout,
      retryCount: values.retry,
      interRequestDelayMs: values.rxDelay,
      autoReconnect: values.autoReconnect,
    };
  }
  // RTU：显式映射表单字段到 profile（spread 无法把 rtuTimeout→requestTimeoutMs、
  // retry→retryCount、rxDelay→interRequestDelayMs 等映射，需逐字段落地）。
  return {
    ...(base as RtuConnectionProfile),
    baudRate: values.baudRate,
    dataBits: values.dataBits,
    stopBits: values.stopBits,
    parity: values.parity,
    flowControl: values.flowControl,
    requestTimeoutMs: values.rtuTimeout,
    retryCount: values.retry,
    interRequestDelayMs: values.rxDelay,
    protocol: "rtu",
  };
}

/** profile → 表单值（未选中的协议字段使用默认值占位）。 */
export function profileToValues(
  profile: RtuConnectionProfile | TcpConnectionProfile,
): ConnectionSettingsValues {
  if (profile.protocol === "tcp") {
    return {
      protocol: "tcp",
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "off",
      rxDelay: profile.interRequestDelayMs,
      rtuTimeout: defaultConfig.rtu.requestTimeoutMs,
      retry: profile.retryCount,
      host: profile.host,
      port: profile.port,
      unitId: profile.unitId,
      tcpTimeout: profile.requestTimeoutMs,
      autoReconnect: profile.autoReconnect,
    };
  }
  return {
    protocol: "rtu",
    baudRate: profile.baudRate,
    dataBits: profile.dataBits,
    stopBits: profile.stopBits,
    parity: profile.parity,
    flowControl:
      profile.flowControl === "xon-xoff" ? "off" : profile.flowControl,
    rxDelay: profile.interRequestDelayMs,
    rtuTimeout: profile.requestTimeoutMs,
    retry: profile.retryCount,
    host: "",
    port: 502,
    unitId: 0,
    // autoReconnect 为 TCP 专属（RTU 无此字段），RTU 表单值恒 false。
    // tcpTimeout 为 TCP 字段的占位默认（切协议不串值）。
    tcpTimeout: defaultConfig.tcp.requestTimeoutMs,
    autoReconnect: false,
  };
}

/** 从表单值中提取需要持久化的连接设置（按协议判别）。 */
export function extractPersistedSettings(
  values: ConnectionSettingsValues,
): PersistedConnectionSettings {
  if (values.protocol === "tcp") {
    return {
      protocol: "tcp",
      host: values.host,
      port: values.port,
      unitId: values.unitId,
      requestTimeoutMs: values.tcpTimeout,
      retryCount: values.retry,
      interRequestDelayMs: values.rxDelay,
      autoReconnect: values.autoReconnect,
    };
  }
  return {
    protocol: "rtu",
    baudRate: values.baudRate,
    dataBits: values.dataBits,
    stopBits: values.stopBits,
    parity: values.parity,
    flowControl: values.flowControl,
    requestTimeoutMs: values.rtuTimeout,
    retryCount: values.retry,
    interRequestDelayMs: values.rxDelay,
  };
}
