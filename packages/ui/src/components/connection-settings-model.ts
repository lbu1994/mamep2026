import type { RtuConnectionProfile } from "@mamep2026/domain";
import { z } from "zod";

export const settingsSchema = z.object({
  baudRate: z.number().int().positive(),
  dataBits: z.union([z.literal(7), z.literal(8)]),
  stopBits: z.union([z.literal(1), z.literal(2)]),
  parity: z.enum(["none", "even", "odd"]),
  flowControl: z.enum(["off", "rts-cts"]),
  slaveAddress: z.number().int().min(0).max(255),
  rxDelay: z.number().int().min(0).max(5000),
  timeout: z.number().int().min(50).max(60000),
  retry: z.number().int().min(0).max(10),
  addressAdjust: z.enum(["off", "on"]),
});

export type ConnectionSettingsValues = z.infer<typeof settingsSchema>;

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
    slaveAddress: profile.slaveAddress,
    rxDelay: profile.interRequestDelayMs,
    timeout: profile.requestTimeoutMs,
    retry: profile.retryCount,
    addressAdjust: profile.addressAdjust,
  };
}
