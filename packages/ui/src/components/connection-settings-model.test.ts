import { describe, expect, it } from "vitest";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import {
  extractPersistedSettings,
  profileToValues,
  type ConnectionSettingsValues,
} from "./connection-settings-model";

describe("connection-settings-model persistence mapping", () => {
  it("extractPersistedSettings maps all configurable fields (port + non-port)", () => {
    const values: ConnectionSettingsValues = {
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: "even",
      flowControl: "rts-cts",
      slaveAddress: 5,
      rxDelay: 120,
      timeout: 2000,
      retry: 3,
      addressAdjust: "on",
    };
    expect(extractPersistedSettings(values)).toEqual({
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: "even",
      flowControl: "rts-cts",
      slaveAddress: 5,
      requestTimeoutMs: 2000,
      retryCount: 3,
      interRequestDelayMs: 120,
      addressAdjust: "on",
    });
  });

  it("profileToValues restores both port and non-port values from a profile", () => {
    const profile = createDefaultRtuProfile();
    profile.baudRate = 115200;
    profile.dataBits = 7;
    profile.stopBits = 2;
    profile.parity = "even";
    profile.flowControl = "rts-cts";
    profile.slaveAddress = 7;
    profile.requestTimeoutMs = 2500;
    profile.retryCount = 2;
    profile.interRequestDelayMs = 150;
    profile.addressAdjust = "on";

    expect(profileToValues(profile)).toEqual({
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: "even",
      flowControl: "rts-cts",
      slaveAddress: 7,
      rxDelay: 150,
      timeout: 2500,
      retry: 2,
      addressAdjust: "on",
    });
  });
});
