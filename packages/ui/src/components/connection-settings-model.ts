import { type RtuConnectionProfile } from "@mamep2026/domain";
import { z } from "zod";

export const settingsSchema = z.object({
  baudRate: z.number().int().positive(),
  dataBits: z.union([z.literal(7), z.literal(8)]),
  stopBits: z.union([z.literal(1), z.literal(2)]),
  parity: z.enum(["none", "even", "odd"]),
  flowControl: z.enum(["off", "rts-cts"]),
  rxDelay: z.number().int().min(0).max(5000),
  timeout: z.number().int().min(50).max(60000),
  retry: z.number().int().min(0).max(10),
  addressAdjust: z.enum(["off", "on"]),
});

export type ConnectionSettingsValues = z.infer<typeof settingsSchema>;

/**
 * 随工作区持久化的连接设置子集（2026-08-17 确认）：除「串口/端口选择」外的全部
 * 可配置参数（波特率/数据位/停止位/校验位/流控 + 超时/重试/Rx Delay/Address
 * Adjust）。串口/端口选择是运行时会话状态，不进入该集合。
 * 从站地址已按表独立设置（2026-08-19），不再属于全局连接设置。
 */
export const persistedSettingsSchema = z.object({
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

export type PersistedConnectionSettings = z.infer<
  typeof persistedSettingsSchema
>;

export function toProfile(
  values: ConnectionSettingsValues,
  base: RtuConnectionProfile,
): RtuConnectionProfile {
  return { ...base, ...values };
}

export function profileToValues(
  profile: RtuConnectionProfile,
): ConnectionSettingsValues {
  return {
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
  };
}

/** 从表单值中提取需要持久化的连接设置（表单字段名 -> profile 字段名）。 */
export function extractPersistedSettings(
  values: ConnectionSettingsValues,
): PersistedConnectionSettings {
  return {
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
