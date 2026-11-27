import type {
  FlowControl,
  Parity,
  RtuConnectionProfile,
} from "@mamep2026/domain";

export type SerialPlatform = "browser" | "electron" | "vscode" | "android";

export const STANDARD_SERIAL_BAUD_RATES: readonly number[] = Object.freeze([
  1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200,
]);

export interface SerialParameterSupport {
  readonly baudRates: readonly number[];
  readonly customBaudRates: boolean;
  readonly dataBits: readonly number[];
  readonly stopBits: readonly number[];
  readonly parity: readonly Parity[];
  readonly flowControl: readonly FlowControl[];
}

const webSerialSupport: SerialParameterSupport = Object.freeze({
  baudRates: STANDARD_SERIAL_BAUD_RATES,
  customBaudRates: true,
  dataBits: Object.freeze([7, 8]),
  stopBits: Object.freeze([1, 2]),
  parity: Object.freeze<Parity[]>(["none", "even", "odd"]),
  flowControl: Object.freeze<FlowControl[]>(["off", "rts-cts"]),
});

const nodeSerialSupport: SerialParameterSupport = Object.freeze({
  ...webSerialSupport,
  flowControl: Object.freeze<FlowControl[]>(["off", "rts-cts", "xon-xoff"]),
});

/** Adapter limits only. The selected device or driver can still reject an open request. */
export const serialParameterSupport: Readonly<
  Record<SerialPlatform, SerialParameterSupport>
> = Object.freeze({
  browser: webSerialSupport,
  electron: webSerialSupport,
  vscode: nodeSerialSupport,
  android: Object.freeze({ ...nodeSerialSupport, customBaudRates: false }),
});

export type SerialParameterValidation =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Reject unsupported parameters before opening a port. Never replace stored values. */
export function validatePlatformSerialParameters(
  profile: RtuConnectionProfile,
  platform: SerialPlatform,
): SerialParameterValidation {
  const support = serialParameterSupport[platform];
  if (!Number.isSafeInteger(profile.baudRate) || profile.baudRate <= 0) {
    return {
      ok: false,
      reason: `baudRate ${profile.baudRate} is not a positive safe integer`,
    };
  }
  if (
    !support.customBaudRates &&
    !support.baudRates.includes(profile.baudRate)
  ) {
    return {
      ok: false,
      reason: `unsupported baud rate ${profile.baudRate} on ${platform}`,
    };
  }
  for (const field of [
    "dataBits",
    "stopBits",
    "parity",
    "flowControl",
  ] as const) {
    const supported: readonly (string | number)[] = support[field];
    if (!supported.includes(profile[field])) {
      return {
        ok: false,
        reason: `${field} ${profile[field]} is not supported on ${platform}`,
      };
    }
  }
  return { ok: true };
}
