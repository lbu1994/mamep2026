/**
 * RTU 会话 RPC 载荷往返测试（session-payloads，HostMessage v1）。
 * 覆盖：RtuConnectionProfile / RegisterRow / CommunicationLogEvent / ApplicationMessage
 * 的 toPayload → fromPayload 往返不丢失字段（含品牌化 ID、RegisterAddress/RawRegisterValue 类对象、bytes↔hex）。
 */
import { describe, expect, it } from "vitest";
import {
  commLogEventFromPayload,
  registerRowFromPayload,
  rtuConnectionProfileFromPayload,
  tcpConnectionProfileFromPayload,
  toCommLogEventPayload,
  toRegisterRowPayload,
  toRtuConnectionProfilePayload,
  toTcpConnectionProfilePayload,
} from "./session-payloads";
import {
  createDefaultRtuProfile,
  createDefaultTcpProfile,
  createEmptyRow,
  RegisterAddress,
  type RegisterRow,
} from "@mamep2026/domain";
import type { CommunicationLogEvent } from "@mamep2026/communication";

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
    profile.addressAdjust = "on";
    const restored = rtuConnectionProfileFromPayload(
      toRtuConnectionProfilePayload(profile),
    );
    expect(restored.id).toBe(profile.id);
    expect(restored.name).toBe("RTU-COM4");
    expect(restored.baudRate).toBe(19200);
    expect(restored.dataBits).toBe(7);
    expect(restored.addressAdjust).toBe("on");
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
    expect(restored.interRequestDelayMs).toBe(50);
  });
});

describe("RegisterRow payload 往返", () => {
  it("toPayload → fromPayload 保留 rowId/addressValue/lastKnownRawValue", () => {
    const row = makeRow(0x1000, "04D2");
    const payload = toRegisterRowPayload(row);
    expect(payload.addressValue).toEqual({ value: 0x1000 });
    const restored = registerRowFromPayload(payload);
    expect(restored.rowId).toBe(row.rowId);
    expect(restored.addressValue?.value).toBe(0x1000);
    expect(restored.cellText).toBe("04D2");
    expect(restored.lastKnownRawValue).toBeNull();
  });

  it("空地址行往返保持 addressValue null", () => {
    const row = makeRow(0);
    row.addressValue = null;
    const restored = registerRowFromPayload(toRegisterRowPayload(row));
    expect(restored.addressValue).toBeNull();
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
      durationMs: 12,
    };
    const payload = toCommLogEventPayload(event);
    expect(payload.bytesHex).toBe("010300000001840a");
    const restored = commLogEventFromPayload(payload);
    expect(Array.from(restored.bytes)).toEqual(Array.from(event.bytes));
    expect(restored.status).toBe("success");
    expect(restored.source).toBe("manual-read");
  });
});
