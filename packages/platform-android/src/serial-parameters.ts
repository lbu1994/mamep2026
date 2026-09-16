/**
 * USB 串口链路参数校验（ADR-050 Phase 2）。
 *
 * 为什么在 `platform-android` 重复一小段 `packages/platform-node` 的同类逻辑：
 * 两个平台包是**兄弟关系**，互不依赖（`platform-android` 不得为了复用而依赖 Node 适配层），
 * 而同一条规则又必须对两端一致生效。故此处保留一份**极小**的规则实现，并保持错误码/文案同源
 * （`SERIAL_PARAMETER_UNSUPPORTED` / `errors.serialParameterUnsupported`）。
 *
 * 校验只覆盖「本平台能否参数化」；`flowControl` 是否真被驱动支持由原生侧决定，
 * 不支持时按**打开失败**如实上报，不静默忽略（用户决策 2026-09-10 Q5）。
 */
import type { RtuConnectionProfile } from "@mamep2026/domain";

/** 支持的波特率（与 `packages/platform-node` 保持同一集合）。 */
export const ANDROID_SUPPORTED_BAUD_RATES: readonly number[] = Object.freeze([
  1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200,
]);

export type SerialParameterValidation =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** 校验 RTU profile 的串口链路参数是否受 Android 端支持。 */
export function validateSerialParameters(
  profile: RtuConnectionProfile,
): SerialParameterValidation {
  if (!ANDROID_SUPPORTED_BAUD_RATES.includes(profile.baudRate)) {
    return {
      ok: false,
      reason: `unsupported baud rate ${profile.baudRate}（supported: ${ANDROID_SUPPORTED_BAUD_RATES.join(", ")}）`,
    };
  }
  if (profile.dataBits !== 7 && profile.dataBits !== 8) {
    return { ok: false, reason: `unsupported data bits ${profile.dataBits}` };
  }
  if (profile.stopBits !== 1 && profile.stopBits !== 2) {
    return { ok: false, reason: `unsupported stop bits ${profile.stopBits}` };
  }
  if (
    profile.parity !== "none" &&
    profile.parity !== "even" &&
    profile.parity !== "odd"
  ) {
    return { ok: false, reason: `unsupported parity ${profile.parity}` };
  }
  if (
    profile.flowControl !== "off" &&
    profile.flowControl !== "rts-cts" &&
    profile.flowControl !== "xon-xoff"
  ) {
    return {
      ok: false,
      reason: `unsupported flow control ${profile.flowControl}`,
    };
  }
  return { ok: true };
}
