import {
  createMamepError,
  type MamepError,
  type RtuConnectionProfile,
  type TcpConnectionProfile,
} from "@mamep2026/domain";
import { validatePlatformSerialParameters } from "@mamep2026/platform-api";
import type { HostIdentity } from "./host";

/** Check imported, restored and edited profiles without changing their values. */
export function getConnectionSupportError(
  host: HostIdentity,
  profile: RtuConnectionProfile | TcpConnectionProfile,
): MamepError | null {
  const supported =
    profile.protocol === "tcp"
      ? host.capabilities.modbusTcp
      : host.capabilities.modbusRtu;
  if (!supported) {
    return createMamepError({
      code: "CONNECTION_PROTOCOL_UNSUPPORTED",
      category: "connection",
      userMessageKey: "connection.protocolUnsupported",
      technicalMessage: `${profile.protocol.toUpperCase()} is not supported on ${host.platform}`,
    });
  }
  if (profile.protocol === "rtu") {
    const validation = validatePlatformSerialParameters(profile, host.platform);
    if (!validation.ok) {
      return createMamepError({
        code: "SERIAL_PARAMETER_UNSUPPORTED",
        category: "connection",
        userMessageKey: "errors.serialParameterUnsupported",
        technicalMessage: validation.reason,
      });
    }
  }
  return null;
}
