import { describe, expect, it } from "vitest";
import {
  createDefaultRtuProfile,
  RegisterAddress,
  ok,
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
import { appendCrc } from "@mamep2026/protocol-modbus";
import { RegisterTableService } from "./table-service";

/** 注入式 Address Adjust 变换（2026-09-02 插件外部化：测试模拟随包插件提供）。 */
const minusOneTransform = {
  id: "builtin.address-adjust",
  protocol: "rtu",
  apply: (v: number) => ok(v - 1),
  validate: (v: number) => ok(v === 0 ? null : null),
};

function setup(addressAdjust: "off" | "on" = "off") {
  const clock = new VirtualClock();
  const transport = new FakeTransport();
  const device = new ScriptedModbusRtuDevice();
  transport.device = device;
  const profile = createDefaultRtuProfile();
  const logs: CommunicationLogEvent[] = [];
  const session = new CommunicationSession({
    transport,
    clock,
    config: profile,
    onLog: (e) => logs.push(e),
  });
  const service = new RegisterTableService({
    getSession: () => session,
    getAddressTransform: () =>
      addressAdjust === "on" ? minusOneTransform : null,
    clock,
  });
  return { clock, transport, device, session, service, logs, profile };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** 分步推进虚拟时钟（每步间 flush microtask），让链式定时器（延迟→Rx Delay）逐个触发。 */
async function advanceVirtual(
  clock: VirtualClock,
  totalMs: number,
  step = 25,
): Promise<void> {
  for (let t = 0; t < totalMs; t += step) {
    clock.advance(step);
    await flush();
  }
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
      expect(applied.value.registerValues?.[0]?.value).toBe(0);
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

describe("RegisterTableService 写后回读（2026-08-26）", () => {
  it("writeVerify immediate：写入后 FC03 回读一致 → verify-matched", async () => {
    const { session, service, clock } = setup();
    await session.connect();
    const row = makeRow(0x0002, "hex");
    row.cellText = "1234";
    const result = await service.writeRow(row, {
      writeVerify: { mode: "immediate", delayMs: null },
    });
    await flush();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        kind: "write-succeeded-verify-matched",
        readValues: [0x1234],
      });
    }
    void clock;
  });

  it("writeVerify OFF：仅写入、不回读 → no-verify", async () => {
    const { session, service } = setup();
    await session.connect();
    const row = makeRow(0x0002, "hex");
    row.cellText = "1234";
    const result = await service.writeRow(row, {
      writeVerify: { mode: "off", delayMs: null },
    });
    await flush();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: "write-succeeded-no-verify" });
    }
  });

  it("writeVerify delayed 100：延迟后回读一致 → verify-matched", async () => {
    const { session, service, clock } = setup();
    await session.connect();
    const row = makeRow(0x0002, "hex");
    row.cellText = "1234";
    const promise = service.writeRow(row, {
      writeVerify: { mode: "delayed", delayMs: 100 },
    });
    await flush();
    // 延迟未满（<100ms）时回读不应发生。
    clock.advance(60);
    await flush();
    // 分步推进：延迟 100ms 期满 → 回读入队 → Rx Delay 50ms 期满 → 发送读帧。
    await advanceVirtual(clock, 200);
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        kind: "write-succeeded-verify-matched",
        readValues: [0x1234],
      });
    }
  });

  it("设备写入未生效（写后回读值不一致）→ verify-mismatched", async () => {
    const { session, service, transport } = setup();
    await session.connect();
    // 自定义设备：FC10 只回 ack 不存储（写入不生效），FC03 返回预置值。
    const ignoring = new ScriptedModbusRtuDevice();
    ignoring.handleFrame = (frame: Uint8Array) => {
      const slave = frame[0] ?? 1;
      const functionCode = frame[1] ?? 0;
      const address = ((frame[2] ?? 0) << 8) | (frame[3] ?? 0);
      if (functionCode === 0x10) {
        return appendCrc(
          Uint8Array.from([
            slave,
            0x10,
            (address >> 8) & 0xff,
            address & 0xff,
            0x00,
            0x01,
          ]),
        );
      }
      if (functionCode === 0x03) {
        const value = ignoring.getRegister(address) ?? 0;
        return appendCrc(
          Uint8Array.from([
            slave,
            0x03,
            0x02,
            (value >> 8) & 0xff,
            value & 0xff,
          ]),
        );
      }
      return appendCrc(Uint8Array.from([slave, functionCode | 0x80, 0x01]));
    };
    ignoring.setRegister(0x0002, 0x5678);
    transport.device = ignoring;

    const row = makeRow(0x0002, "hex");
    row.cellText = "1234";
    const result = await service.writeRow(row, {
      writeVerify: { mode: "immediate", delayMs: null },
    });
    await flush();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        kind: "write-succeeded-verify-mismatched",
        expectedValues: [0x1234],
        readValues: [0x5678],
      });
    }
  });
});
