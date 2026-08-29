import { describe, expect, it } from "vitest";
import {
  createDefaultRtuProfile,
  createDefaultTcpProfile,
} from "@mamep2026/domain";
import {
  extractPersistedSettings,
  profileToValues,
  settingsSchema,
  type ConnectionSettingsValues,
} from "./connection-settings-model";

describe("connection-settings-model persistence mapping", () => {
  it("extractPersistedSettings maps all configurable fields (port + non-port)", () => {
    const values: ConnectionSettingsValues = {
      protocol: "rtu",
      host: "",
      port: 502,
      unitId: 0,
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: "even",
      flowControl: "rts-cts",
      rxDelay: 120,
      timeout: 2000,
      retry: 3,
      addressAdjust: "on",
      autoReconnect: false,
    };
    expect(extractPersistedSettings(values)).toEqual({
      protocol: "rtu",
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: "even",
      flowControl: "rts-cts",
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
    profile.requestTimeoutMs = 2500;
    profile.retryCount = 2;
    profile.interRequestDelayMs = 150;
    profile.addressAdjust = "on";

    expect(profileToValues(profile)).toEqual({
      protocol: "rtu",
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: "even",
      flowControl: "rts-cts",
      rxDelay: 150,
      timeout: 2500,
      retry: 2,
      addressAdjust: "on",
      host: "",
      port: 502,
      unitId: 0,
      autoReconnect: false,
    });
  });

  it("profileToValues 对 TCP profile 返回 TCP 表单值", () => {
    const profile = createDefaultTcpProfile("PLC");
    profile.host = "192.168.1.10";
    profile.port = 502;
    profile.unitId = 7;
    profile.requestTimeoutMs = 1500;
    profile.retryCount = 2;
    profile.autoReconnect = true;
    expect(profileToValues(profile)).toEqual({
      protocol: "tcp",
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "off",
      rxDelay: 50,
      timeout: 1500,
      retry: 2,
      addressAdjust: "off",
      host: "192.168.1.10",
      port: 502,
      unitId: 7,
      autoReconnect: true,
    });
  });
});

describe("settingsSchema（表单校验：host 非空仅 TCP 生效，2026-08-23 回归修复）", () => {
  /** RTU 表单值：host 为空串是正常默认（TCP 字段不渲染、不应参与校验）。 */
  const rtuValues = {
    protocol: "rtu" as const,
    host: "",
    port: 502,
    unitId: 0,
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "off",
    rxDelay: 50,
    timeout: 1000,
    retry: 1,
    addressAdjust: "off",
    autoReconnect: false,
  };

  it("RTU 提交（host 为空）通过校验", () => {
    const result = settingsSchema.safeParse(rtuValues);
    expect(result.success).toBe(true);
  });

  it("TCP 提交（host 为空）校验失败并指向 host 字段", () => {
    const result = settingsSchema.safeParse({
      ...rtuValues,
      protocol: "tcp",
      host: "",
      port: 502,
      unitId: 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "host")).toBe(true);
    }
  });

  it("TCP 提交（host 非空）通过校验", () => {
    const result = settingsSchema.safeParse({
      ...rtuValues,
      protocol: "tcp",
      host: "127.0.0.1",
      port: 502,
      unitId: 1,
    });
    expect(result.success).toBe(true);
  });
});
