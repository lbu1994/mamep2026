import {
  type RtuConnectionProfile,
  type TcpConnectionProfile,
} from "@mamep2026/domain";
import type { ConnectionConfigObject } from "@mamep2026/connection-config";
import { z } from "zod";

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
    timeout: z.number().int().min(50).max(60000),
    retry: z.number().int().min(0).max(10),
    addressAdjust: z.enum(["off", "on"]),
    // ---- TCP（保持必填类型；非空校验仅 TCP 协议下经 superRefine 生效）----
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    unitId: z.number().int().min(0).max(255),
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
  requestTimeoutMs: z.number().int().min(50).max(60000),
  retryCount: z.number().int().min(0).max(10),
  interRequestDelayMs: z.number().int().min(0).max(5000),
  addressAdjust: z.enum(["off", "on"]),
});

/** TCP 随工作区持久化的连接设置子集（2026-08-23 两端 TCP 接线：host/port/unitId/超时/重试）。 */
export const tcpPersistedSettingsSchema = z.object({
  protocol: z.literal("tcp"),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  unitId: z.number().int().min(0).max(255),
  requestTimeoutMs: z.number().int().min(50).max(60000),
  retryCount: z.number().int().min(0).max(10),
  interRequestDelayMs: z.number().int().min(0).max(5000),
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
      requestTimeoutMs: values.timeout,
      retryCount: values.retry,
      interRequestDelayMs: values.rxDelay,
    };
  }
  return { ...(base as RtuConnectionProfile), ...values, protocol: "rtu" };
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
      timeout: profile.requestTimeoutMs,
      retry: profile.retryCount,
      addressAdjust: "off",
      host: profile.host,
      port: profile.port,
      unitId: profile.unitId,
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
    timeout: profile.requestTimeoutMs,
    retry: profile.retryCount,
    addressAdjust: profile.addressAdjust,
    host: "",
    port: 502,
    unitId: 0,
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
      requestTimeoutMs: values.timeout,
      retryCount: values.retry,
      interRequestDelayMs: values.rxDelay,
    };
  }
  return {
    protocol: "rtu",
    baudRate: values.baudRate,
    dataBits: values.dataBits,
    stopBits: values.stopBits,
    parity: values.parity,
    flowControl: values.flowControl,
    requestTimeoutMs: values.timeout,
    retryCount: values.retry,
    interRequestDelayMs: values.rxDelay,
    addressAdjust: values.addressAdjust,
  };
}

/** 从配置文件载入连接对象的结果（ADR-023）。 */
export interface LoadedConnectionSettings {
  /** 预填表单值。 */
  values: ConnectionSettingsValues;
  /** RTU：配置文件指定的串口名（端口匹配用）；TCP：null。 */
  port: string | null;
  /** RTU：配置文件指定的从站地址（载入时同步当前表从站地址）；TCP：null。 */
  slaveAddress: number | null;
}

/** 连接对象 → 连接设置表单值 + 端口/从站地址（「从配置载入」预填，ADR-023）。 */
export function loadConnectionToSettings(
  connection: ConnectionConfigObject,
): LoadedConnectionSettings {
  if (connection.protocol === "tcp") {
    return {
      values: {
        protocol: "tcp",
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "off",
        rxDelay: connection.interRequestDelayMs,
        timeout: connection.requestTimeoutMs,
        retry: connection.retryCount,
        addressAdjust: "off",
        host: connection.host,
        port: connection.port,
        unitId: connection.unitId,
      },
      port: null,
      slaveAddress: null,
    };
  }
  return {
    values: {
      protocol: "rtu",
      baudRate: connection.baudRate,
      dataBits: connection.dataBits,
      stopBits: connection.stopBits,
      parity: connection.parity,
      flowControl:
        connection.flowControl === "xon-xoff" ? "off" : connection.flowControl,
      rxDelay: connection.interRequestDelayMs,
      timeout: connection.requestTimeoutMs,
      retry: connection.retryCount,
      addressAdjust: connection.addressAdjust,
      host: "",
      port: 502,
      unitId: 0,
    },
    port: connection.port,
    slaveAddress: connection.slaveAddress,
  };
}
