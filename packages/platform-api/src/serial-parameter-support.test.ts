import { describe, expect, it } from "vitest";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import {
  serialParameterSupport,
  validatePlatformSerialParameters,
} from "./serial-parameter-support";

describe("platform serial parameters", () => {
  it.each([
    ["browser", false, true],
    ["electron", false, true],
    ["vscode", true, true],
    ["android", true, false],
  ] as const)(
    "checks %s without changing the profile",
    (platform, xonXoff, customBaud) => {
      const profile = {
        ...createDefaultRtuProfile(),
        flowControl: "xon-xoff" as const,
      };
      expect(validatePlatformSerialParameters(profile, platform).ok).toBe(
        xonXoff,
      );
      expect(profile.flowControl).toBe("xon-xoff");
      expect(
        validatePlatformSerialParameters(
          { ...profile, flowControl: "rts-cts" },
          platform,
        ).ok,
      ).toBe(true);
      expect(
        validatePlatformSerialParameters(
          { ...profile, flowControl: "off", baudRate: 921600 },
          platform,
        ).ok,
      ).toBe(customBaud);
      expect(serialParameterSupport[platform].stopBits).toEqual([1, 2]);
      expect(serialParameterSupport[platform].dataBits).toEqual([7, 8]);
      expect(serialParameterSupport[platform].parity).toEqual([
        "none",
        "even",
        "odd",
      ]);
    },
  );

  it.each([0, -1, 9600.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid baud rate %s",
    (baudRate) => {
      expect(
        validatePlatformSerialParameters(
          { ...createDefaultRtuProfile(), baudRate },
          "browser",
        ).ok,
      ).toBe(false);
    },
  );
});
