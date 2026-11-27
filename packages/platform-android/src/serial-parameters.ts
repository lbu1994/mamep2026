import type { RtuConnectionProfile } from "@mamep2026/domain";
import {
  STANDARD_SERIAL_BAUD_RATES,
  validatePlatformSerialParameters,
  type SerialParameterValidation,
} from "@mamep2026/platform-api";

export type { SerialParameterValidation } from "@mamep2026/platform-api";
export const ANDROID_SUPPORTED_BAUD_RATES = STANDARD_SERIAL_BAUD_RATES;

/** Check adapter limits before calling the native bridge. The USB driver checks flow control on open. */
export function validateSerialParameters(
  profile: RtuConnectionProfile,
): SerialParameterValidation {
  return validatePlatformSerialParameters(profile, "android");
}
