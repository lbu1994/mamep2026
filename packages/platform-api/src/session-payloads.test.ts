/**
 * RTU 会话 RPC 载荷往返测试（session-payloads，HostMessage v2）。
 * 覆盖：RtuConnectionProfile / RegisterRow / CommunicationLogEvent / ApplicationMessage
 * 的 toPayload → fromPayload 往返不丢失字段（含品牌化 ID、RegisterAddress/RawRegisterValue 类对象、bytes↔hex）。
 */
import { describe, expect, it } from "vitest";
import {
  commLogEventFromPayload,
  readVerifySettingsFromPayload,
  registerRowFromPayload,
  rtuConnectionProfileFromPayload,
  sessionWriteRowPayloadSchema,
  tcpConnectionProfileFromPayload,
  toCommLogEventPayload,
  toReadVerifySettingsPayload,
  toRegisterRowPayload,
  toRtuConnectionProfilePayload,
  toTcpConnectionProfilePayload,
  toWriteOutcomePayload,
} from "./session-payloads";
import {
  createDefaultRtuProfile,
  createDefaultTcpProfile,
  createEmptyRow,
  RegisterAddress,
  type RegisterRow,
} from "@mamep2026/domain";
import type {
  CommunicationLogEvent,
  WriteOutcome,
} from "@mamep2026/communication";

function makeRow(address: number, cellText = ""): RegisterRow {
  const row = createEmptyRow();
  const parsed = RegisterAddress.create(address);
  row.addressValue = parsed.ok ? parsed.value : null;
  row.cellText = cellText;
  return row;
}

describe("RtuConnectionProfile payload 往返", () => {
  it("toPayload → fromPayload 保留全部字段与连接配置 id", () => {
    const profile = createDefaultRtuProfile("RTU-COM4");
    profile.baudRate = 19200;
    profile.dataBits = 7;
    const restored = rtuConnectionProfileFromPayload(
      toRtuConnectionProfilePayload(profile),
    );
    expect(restored.id).toBe(profile.id);
    expect(restored.name).toBe("RTU-COM4");
    expect(restored.baudRate).toBe(19200);
    expect(restored.dataBits).toBe(7);
    expect(restored.recentPortHint).toBeNull();
  });
});

describe("TcpConnectionProfile payload 往返（2026-08-23 TCP 接线）", () => {
  it("toPayload → fromPayload 保留全部字段与连接配置 id", () => {
    const profile = createDefaultTcpProfile("PLC-502");
    profile.host = "192.168.1.10";
    profile.port = 502;
    profile.unitId = 1;
    profile.connectTimeoutMs = 3000;
    profile.requestTimeoutMs = 2000;
    profile.retryCount = 3;
    const restored = tcpConnectionProfileFromPayload(
      toTcpConnectionProfilePayload(profile),
    );
    expect(restored.id).toBe(profile.id);
    expect(restored.protocol).toBe("tcp");
    expect(restored.name).toBe("PLC-502");
    expect(restored.host).toBe("192.168.1.10");
    expect(restored.port).toBe(502);
    expect(restored.unitId).toBe(1);
    expect(restored.connectTimeoutMs).toBe(3000);
    expect(restored.requestTimeoutMs).toBe(2000);
    expect(restored.retryCount).toBe(3);
    expect(restored.autoReconnect).toBe(false);
  });
});

describe("RegisterRow payload 往返", () => {
  it("toPayload → fromPayload 保留 rowId/addressValue/registerValues", () => {
    const row = makeRow(0x1000, "04D2");
    const payload = toRegisterRowPayload(row);
    expect(payload.addressValue).toEqual({ value: 0x1000 });
    const restored = registerRowFromPayload(payload);
    expect(restored.rowId).toBe(row.rowId);
    expect(restored.addressValue?.value).toBe(0x1000);
    expect(restored.cellText).toBe("04D2");
    expect(restored.registerValues).toBeNull();
  });

  it("空地址行往返保持 addressValue null", () => {
    const row = makeRow(0);
    row.addressValue = null;
    const restored = registerRowFromPayload(toRegisterRowPayload(row));
    expect(restored.addressValue).toBeNull();
  });

  it("范围行子行元数据 registers 往返不丢失（2026-08-27）", () => {
    const row = makeRow(0x1000, "12 34");
    row.registerCount = 2;
    row.registers = [
      { name: "Hi", comment: "high", dataType: "hex" },
      { name: "Lo", comment: "low", dataType: "unsigned-0.1" },
    ];
    const restored = registerRowFromPayload(toRegisterRowPayload(row));
    expect(restored.registers).toEqual(row.registers);
    expect(restored.registerCount).toBe(2);
  });

  it("无 registers 的 payload 往返后回退为 null", () => {
    const row = makeRow(0x1000);
    row.registerCount = 2;
    row.registers = null;
    const payload = toRegisterRowPayload(row);
    // 老数据/旧协议载荷缺省 registers：schema 默认 null，往返不崩。
    const restored = registerRowFromPayload(payload);
    expect(restored.registers).toBeNull();
  });

  it("位级注释 bitComments 往返不丢失（ADR-052）", () => {
    const row = makeRow(0x1000, "10000000 00000001");
    row.dataType = "binary";
    row.bitComments = [
      Array.from({ length: 16 }, (_, index) =>
        index === 0 ? "carry" : index === 15 ? "alarm" : "",
      ),
    ];
    const payload = toRegisterRowPayload(row);
    expect(payload.bitComments).toEqual(row.bitComments);
    const restored = registerRowFromPayload(payload);
    expect(restored.bitComments).toEqual(row.bitComments);
  });

  it("位级名称 bitNames 往返不丢失（ADR-052 需求追加）", () => {
    const row = makeRow(0x1000, "10000000 00000001");
    row.dataType = "binary";
    row.bitNames = [
      Array.from({ length: 16 }, (_, index) =>
        index === 15 ? "Alarm bit" : "",
      ),
    ];
    const payload = toRegisterRowPayload(row);
    expect(payload.bitNames).toEqual(row.bitNames);
    const restored = registerRowFromPayload(payload);
    expect(restored.bitNames).toEqual(row.bitNames);
  });

  it("缺省 bitComments/bitNames 的 payload 往返后回退为 null", () => {
    const row = makeRow(0x1000);
    const payload = toRegisterRowPayload(row);
    const restored = registerRowFromPayload(payload);
    expect(restored.bitComments).toBeNull();
    expect(restored.bitNames).toBeNull();
  });
});

describe("CommunicationLogEvent payload 往返", () => {
  it("bytes ↔ hex 无损往返", () => {
    const event: CommunicationLogEvent = {
      timestamp: 12345,
      direction: "request",
      bytes: Uint8Array.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0x84, 0x0a]),
      protocol: "rtu",
      slaveAddress: 1,
      functionCode: 0x03,
      userAddress: 0,
      sentAddress: 0,
      quantity: 1,
      attempt: 1,
      status: "success",
      errorCode: null,
      exceptionCode: null,
      source: "manual-read",
      pluginId: null,
      durationMs: 12,
    };
    const payload = toCommLogEventPayload(event);
    expect(payload.bytesHex).toBe("010300000001840a");
    const restored = commLogEventFromPayload(payload);
    expect(Array.from(restored.bytes)).toEqual(Array.from(event.bytes));
    expect(restored.status).toBe("success");
    expect(restored.source).toBe("manual-read");
  });

  it("codecId 协议（ADR-040）往返：protocol 接受 codecId 字符串", () => {
    const event: CommunicationLogEvent = {
      timestamp: 1,
      direction: "request",
      bytes: Uint8Array.from([0x01, 0x67, 0x01, 0x0d, 0x00, 0x01, 0x00, 0x24]),
      protocol: "yaskawa-memobus",
      slaveAddress: 1,
      functionCode: null,
      userAddress: 0x0024,
      sentAddress: 0x0024,
      quantity: 1,
      attempt: 1,
      status: "success",
      errorCode: null,
      exceptionCode: null,
      source: "manual-read",
      pluginId: null,
      durationMs: 1,
    };
    const payload = toCommLogEventPayload(event);
    expect(payload.protocol).toBe("yaskawa-memobus");
    const restored = commLogEventFromPayload(payload);
    expect(restored.protocol).toBe("yaskawa-memobus");
    expect(restored.functionCode).toBeNull();
  });
});

describe("WriteOutcome payload（写后回读，2026-08-26）", () => {
  it("5 种 kind 往返：no-verify / matched / mismatched / failed / cancelled", () => {
    const outcomes: WriteOutcome[] = [
      { kind: "write-succeeded-no-verify" },
      { kind: "write-succeeded-verify-matched", readValues: [0x1234] },
      {
        kind: "write-succeeded-verify-mismatched",
        expectedValues: [0x1234],
        readValues: [0x5678],
      },
      {
        kind: "write-succeeded-verify-failed",
        errorCode: "MODBUS_EXCEPTION_02",
        userMessageKey: "errors.modbusException",
      },
      { kind: "cancelled-before-verify" },
    ];
    for (const outcome of outcomes) {
      // 投影后经 JSON 往返模拟跨边界（Zod 判别联合在 host-message 校验）。
      const payload = toWriteOutcomePayload(outcome);
      const restored = JSON.parse(JSON.stringify(payload)) as WriteOutcome;
      expect(restored).toEqual(outcome);
    }
  });

  it("readVerifySettings 往返保留 mode/delayMs", () => {
    const settings = { mode: "delayed" as const, delayMs: 200 };
    const restored = readVerifySettingsFromPayload(
      toReadVerifySettingsPayload(settings),
    );
    expect(restored).toEqual(settings);
  });

  it("session-write-row payload 接受可选 writeVerify", () => {
    const rowPayload = toRegisterRowPayload(makeRow(0x1000, "04D2"));
    const parsed = sessionWriteRowPayloadSchema.safeParse({
      row: rowPayload,
      writeVerify: { mode: "immediate", delayMs: null },
      route: { unitAddress: 1, protocol: "rtu" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.writeVerify).toEqual({
        mode: "immediate",
        delayMs: null,
      });
    }
    // 缺省 writeVerify 合法（保持既有行为）。
    const without = sessionWriteRowPayloadSchema.safeParse({
      row: rowPayload,
      route: { unitAddress: 1, protocol: "rtu" },
    });
    expect(without.success).toBe(true);
  });

  it("request route schema rejects invalid Unit IDs and empty protocols", () => {
    expect(
      sessionWriteRowPayloadSchema.safeParse({
        row: toRegisterRowPayload(makeRow(0x1000, "04D2")),
        route: { unitAddress: 256, protocol: "rtu" },
      }).success,
    ).toBe(false);
    expect(
      sessionWriteRowPayloadSchema.safeParse({
        row: toRegisterRowPayload(makeRow(0x1000, "04D2")),
        route: { unitAddress: 1, protocol: "" },
      }).success,
    ).toBe(false);
  });
});
