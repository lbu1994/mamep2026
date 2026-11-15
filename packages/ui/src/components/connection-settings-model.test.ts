import { describe, expect, it } from "vitest";
import {
  createDefaultRtuProfile,
  createDefaultTcpProfile,
} from "@mamep2026/domain";
import {
  extractPersistedSettings,
  profileToValues,
  RTU_TIMEOUT_OPTIONS,
  rtuPersistedSettingsSchema,
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
      rtuTimeout: 80,
      retry: 3,
      tcpTimeout: 1500,
      autoReconnect: false,
    };
    expect(extractPersistedSettings(values)).toEqual({
      protocol: "rtu",
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: "even",
      flowControl: "rts-cts",
      requestTimeoutMs: 80,
      retryCount: 3,
    });
  });

  it("profileToValues restores both port and non-port values from a profile", () => {
    const profile = createDefaultRtuProfile();
    profile.baudRate = 115200;
    profile.dataBits = 7;
    profile.stopBits = 2;
    profile.parity = "even";
    profile.flowControl = "rts-cts";
    profile.requestTimeoutMs = 80;
    profile.retryCount = 2;

    expect(profileToValues(profile)).toEqual({
      protocol: "rtu",
      baudRate: 115200,
      dataBits: 7,
      stopBits: 2,
      parity: "even",
      flowControl: "rts-cts",
      rtuTimeout: 80,
      retry: 2,
      host: "",
      port: 502,
      unitId: 0,
      tcpTimeout: 50,
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
      rtuTimeout: 50,
      retry: 2,
      host: "192.168.1.10",
      port: 502,
      unitId: 7,
      tcpTimeout: 1500,
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
    rtuTimeout: 50,
    retry: 1,
    tcpTimeout: 1500,
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

/** RTU 超时档位基准：5。100 步进 5（既有的 20 项）。 */
const BASE_TIMEOUT_OPTIONS = Array.from({ length: 20 }, (_, i) => 5 * (i + 1));

/** 增补的长超时档位（13 项）。 */
const LONG_TIMEOUT_OPTIONS = [
  150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000,
];

describe("RTU_TIMEOUT_OPTIONS（RTU 超时固定档位，2026-09-16 增补长档位）", () => {
  it("= 既有 5..100（步进 5）+ 长超时阶梯，升序且无重复", () => {
    expect(RTU_TIMEOUT_OPTIONS).toEqual([
      ...BASE_TIMEOUT_OPTIONS,
      ...LONG_TIMEOUT_OPTIONS,
    ]);
    expect(RTU_TIMEOUT_OPTIONS).toHaveLength(33);
    // 升序（Select 按声明顺序渲染，需保持从小到大）。
    expect(RTU_TIMEOUT_OPTIONS).toEqual(
      [...RTU_TIMEOUT_OPTIONS].sort((a, b) => a - b),
    );
    expect(new Set(RTU_TIMEOUT_OPTIONS).size).toBe(33);
    // 默认值 50 必须是合法档位，否则表单初始值无法回显。
    expect(RTU_TIMEOUT_OPTIONS).toContain(50);
  });

  it("不含 105–145 之间的值（100 → 150 有意留空隙）", () => {
    expect(RTU_TIMEOUT_OPTIONS).not.toContain(105);
    expect(RTU_TIMEOUT_OPTIONS).not.toContain(125);
    expect(RTU_TIMEOUT_OPTIONS).not.toContain(145);
  });
});

describe("RTU 超时 schema 上限（2026-09-16 由 100 放宽至 1000）", () => {
  const rtuValues = {
    protocol: "rtu",
    host: "",
    port: 502,
    unitId: 0,
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "off",
    rtuTimeout: 1000,
    retry: 1,
    tcpTimeout: 1500,
    autoReconnect: false,
  };

  it("表单 schema 接受 1000，拒绝 1001 与 4", () => {
    expect(settingsSchema.safeParse(rtuValues).success).toBe(true);
    expect(
      settingsSchema.safeParse({ ...rtuValues, rtuTimeout: 1001 }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ ...rtuValues, rtuTimeout: 4 }).success,
    ).toBe(false);
  });

  it("持久化 schema 接受 1000，拒绝 1001", () => {
    const persisted = {
      protocol: "rtu",
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "off",
      requestTimeoutMs: 1000,
      retryCount: 1,
    };
    expect(rtuPersistedSettingsSchema.safeParse(persisted).success).toBe(true);
    expect(
      rtuPersistedSettingsSchema.safeParse({
        ...persisted,
        requestTimeoutMs: 1001,
      }).success,
    ).toBe(false);
  });
});
