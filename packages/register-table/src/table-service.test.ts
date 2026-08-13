import { describe, expect, it } from "vitest";
import {
  createDefaultRtuProfile,
  RegisterAddress,
  type DataType,
} from "@mamep2026/domain";
import {
  CommunicationSession,
  type CommunicationLogEvent,
} from "@mamep2026/communication";
import {
  FakeTransport,
  ScriptedModbusRtuDevice,
  VirtualClock,
} from "@mamep2026/test-kit";
import { RegisterTableService } from "./table-service";

function setup(addressAdjust: "off" | "on" = "off") {
  const clock = new VirtualClock();
  const transport = new FakeTransport();
  const device = new ScriptedModbusRtuDevice();
  transport.device = device;
  const profile = createDefaultRtuProfile();
  profile.addressAdjust = addressAdjust;
  const logs: CommunicationLogEvent[] = [];
  const session = new CommunicationSession({
    transport,
    clock,
    config: profile,
    onLog: (e) => logs.push(e),
  });
  const service = new RegisterTableService({
    getSession: () => session,
    getAddressAdjustMode: () => profile.addressAdjust,
  });
  return { clock, transport, device, session, service, logs, profile };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function makeRow(address: number, dataType: DataType = "unsigned") {
  const row = RegisterTableService.createRow();
  const addr = RegisterAddress.create(address);
  if (addr.ok) row.addressValue = addr.value;
  row.dataType = dataType;
  row.cellText = "";
  return row;
}

describe("RegisterTableService", () => {
  it("reads a row and applies the formatted result to the cell text", async () => {
    const { session, service } = setup();
    await session.connect();
    const row = makeRow(0x0001, "hex");
    row.cellText = "user-typing-draft";
    const result = await service.readRow(row);
    await flush();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const applied = service.applyReadResult(row, result.value);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.value.cellText).toBe("0000");
      expect(applied.value.lastKnownRawValue?.value).toBe(0);
    }
  });

  it("does not change the cell text when a read fails", async () => {
    const { session, service, transport, clock } = setup();
    // 移除模拟设备应答：请求将超时失败。
    transport.device = null;
    await session.connect();
    const row = makeRow(0x0001);
    row.cellText = "keep-me";
    const promise = service.readRow(row);
    // 推进虚拟时钟触发超时（含一次重试）。
    for (let i = 0; i < 3; i++) {
      clock.advance(1500);
      await flush();
    }
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(row.cellText).toBe("keep-me");
  });

  it("writes the parsed raw value via FC0x10", async () => {
    const { session, service, device } = setup();
    await session.connect();
    const row = makeRow(0x0002, "unsigned-0.1");
    row.cellText = "12.3";
    const result = await service.writeRow(row);
    await flush();
    expect(result.ok).toBe(true);
    expect(device.getRegister(0x0002)).toBe(123);
  });

  it("rejects invalid input before sending anything", async () => {
    const { session, service, transport } = setup();
    await session.connect();
    const row = makeRow(0x0002, "unsigned-0.1");
    row.cellText = "12.34"; // 超过 1 位小数
    const result = await service.writeRow(row);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATA_TOO_MANY_DECIMALS");
    expect(transport.sentFrames).toHaveLength(0);
  });

  it("applies Address Adjust (-1) to the sent address and logs both addresses", async () => {
    const { session, service, transport, logs } = setup("on");
    await session.connect();
    const row = makeRow(0x0002);
    const result = await service.readRow(row);
    await flush();
    expect(result.ok).toBe(true);
    // 发送帧地址应为 0x0001。
    const frame = transport.sentFrames[0];
    expect(frame?.[2]).toBe(0x00);
    expect(frame?.[3]).toBe(0x01);
    const requestLog = logs.find((l) => l.direction === "request");
    expect(requestLog?.userAddress).toBe(0x0002);
    expect(requestLog?.sentAddress).toBe(0x0001);
  });

  it("fails reads when disconnected", async () => {
    const { service } = setup();
    const row = makeRow(0x0001);
    const result = await service.readRow(row);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONNECTION_NOT_CONNECTED");
  });
});
