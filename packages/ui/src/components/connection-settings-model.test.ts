import { describe, expect, it } from "vitest";
import {
  createDefaultRtuProfile,
  createDefaultTcpProfile,
} from "@mamep2026/domain";
import {
  extractPersistedSettings,
  loadConnectionToSettings,
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
    });
  });

  it("profileToValues 对 TCP profile 返回 TCP 表单值", () => {
    const profile = createDefaultTcpProfile("PLC");
    profile.host = "192.168.1.10";
    profile.port = 502;
    profile.unitId = 7;
    profile.requestTimeoutMs = 1500;
    profile.retryCount = 2;
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

describe("loadConnectionToSettings（连接对象配置文件 → 表单值，ADR-023）", () => {
  it("RTU 连接对象：预填端口参数 + 返回串口名与从站地址", () => {
    const loaded = loadConnectionToSettings({
      id: "rtu-com4",
      name: "COM4 slave",
      protocol: "rtu",
      port: "COM4",
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: "even",
      flowControl: "rts-cts",
      slaveAddress: 3,
      requestTimeoutMs: 2000,
      retryCount: 3,
      interRequestDelayMs: 120,
      addressAdjust: "on",
    });
    expect(loaded.port).toBe("COM4");
    expect(loaded.slaveAddress).toBe(3);
    expect(loaded.values).toEqual({
      protocol: "rtu",
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: "even",
      flowControl: "rts-cts",
      rxDelay: 120,
      timeout: 2000,
      retry: 3,
      addressAdjust: "on",
      host: "",
      port: 502,
      unitId: 0,
    });
  });

  it("RTU 连接对象：xon-xoff 流控降级为 off（表单仅支持 off/rts-cts）", () => {
    // parse 后为完整字段（Zod .default() 回填）；此处补全以匹配 ConnectionConfigObject 类型。
    const loaded = loadConnectionToSettings({
      id: "rtu-x",
      name: "x",
      protocol: "rtu",
      port: "COM5",
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "xon-xoff",
      slaveAddress: 1,
      requestTimeoutMs: 1000,
      retryCount: 1,
      interRequestDelayMs: 50,
      addressAdjust: "off",
    });
    expect(loaded.values.flowControl).toBe("off");
  });

  it("TCP 连接对象：预填 host/port/unitId，串口/从站地址为 null", () => {
    const loaded = loadConnectionToSettings({
      id: "tcp-local",
      name: "local",
      protocol: "tcp",
      host: "127.0.0.1",
      port: 1502,
      unitId: 7,
      connectTimeoutMs: 3000,
      requestTimeoutMs: 1500,
      retryCount: 2,
      autoReconnect: false,
      interRequestDelayMs: 80,
    });
    expect(loaded.port).toBeNull();
    expect(loaded.slaveAddress).toBeNull();
    expect(loaded.values).toEqual({
      protocol: "tcp",
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "off",
      rxDelay: 80,
      timeout: 1500,
      retry: 2,
      addressAdjust: "off",
      host: "127.0.0.1",
      port: 1502,
      unitId: 7,
    });
  });
});
