/**
 * 连接配置 → 库打开选项映射（docs/TECH_DESIGN.md §34.3.5）。
 * 端口路径视为不透明字符串原样传递（§34.3.3/§34.3.4），不做任何解析/正则/拼接/降级。
 */
import type { RtuConnectionProfile } from "@mamep2026/domain";
import {
  STANDARD_SERIAL_BAUD_RATES,
  validatePlatformSerialParameters,
} from "@mamep2026/platform-api";
import type { SerialPortOpenLike } from "./serial-port-like";

/** 常用标准波特率（§34.3.5 要求验证的清单）。自定义波特率由库 best-effort 支持。 */
export const SUPPORTED_BAUD_RATES = STANDARD_SERIAL_BAUD_RATES;

/** 将 RTU 连接配置映射为库打开选项。path 来自设备句柄（原始路径），profile 提供参数。 */
export function toSerialPortOpenLike(
  path: string,
  profile: RtuConnectionProfile,
): SerialPortOpenLike {
  return {
    path,
    baudRate: profile.baudRate,
    dataBits: profile.dataBits,
    stopBits: profile.stopBits,
    parity: profile.parity,
    rtscts: profile.flowControl === "rts-cts",
    xon: profile.flowControl === "xon-xoff",
    xoff: profile.flowControl === "xon-xoff",
    lock: true,
  };
}

/** Check Node Serial limits before opening. Return the rejection reason without replacing values. */
export function validateSerialParameters(
  profile: RtuConnectionProfile,
): { ok: true } | { ok: false; reason: string } {
  return validatePlatformSerialParameters(profile, "vscode");
}
