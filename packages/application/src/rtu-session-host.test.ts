/**
 * RtuSessionHost 单测（packages/application，Application 层）。
 * 覆盖：连接/断开、FC03 读 / FC0x10 写、Address Adjust、全表读取、WP 轮询、TM 追踪、
 * 从站地址更新、连接失败清理、设备拔出策略（interrupted → 停止轮询/追踪 + 消息）。
 * 传输注入 FakeTransport + ScriptedModbusRtuDevice（test-kit），虚拟时钟驱动调度。
 */
import { describe, expect, it, vi } from "vitest";
import { RtuSessionHost } from "./rtu-session-host";
import type { RtuSessionHostEvents } from "./rtu-session-host";
import type {
  CommunicationLogEvent,
  ConnectionState,
  TraceSample,
} from "@mamep2026/communication";
import {
  createDefaultRtuProfile,
  createEmptyRow,
  createMamepError,
  fail,
  ok,
  RegisterAddress,
  type RegisterRow,
  type Result,
} from "@mamep2026/domain";
import type { ApplicationMessage } from "@mamep2026/logging";
import {
  FakeTransport,
  ScriptedModbusRtuDevice,
  VirtualClock,
} from "@mamep2026/test-kit";

/** 多轮微任务冲刷：异步链路每层 await 需一次冲刷（仓库 advanceUntil 惯例）。 */
async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

type MockedEvent = ReturnType<typeof vi.fn>;

interface Harness {
  host: RtuSessionHost;
  clock: VirtualClock;
  transport: FakeTransport;
  device: ScriptedModbusRtuDevice;
  events: Record<keyof RtuSessionHostEvents, MockedEvent>;
}

function makeRow(address: number, cellText = ""): RegisterRow {
  const row = createEmptyRow();
  const parsed = RegisterAddress.create(address);
  row.addressValue = parsed.ok ? parsed.value : null;
  row.cellText = cellText;
  return row;
}

function createHarness(): Harness {
  const clock = new VirtualClock();
  const device = new ScriptedModbusRtuDevice();
  const transport = new FakeTransport();
  transport.device = device;
  const events: Record<keyof RtuSessionHostEvents, MockedEvent> = {
    onLog: vi.fn<(event: CommunicationLogEvent) => void>(),
    onStateChange: vi.fn<(state: ConnectionState) => void>(),
    onPollResult:
      vi.fn<(key: string, address: number, result: Result<number>) => void>(),
    onTraceSample: vi.fn<(sample: TraceSample) => void>(),
    onMessage: vi.fn<(message: ApplicationMessage) => void>(),
  };
  const host = new RtuSessionHost({
    clock,
    events: events as RtuSessionHostEvents,
    // 地址变换解析（插件外部化）：模拟随包 address-adjust 插件提供的 resolver。
    resolveAddressTransform: (id) =>
      id === "builtin.address-adjust"
        ? {
            id,
            protocol: "rtu",
            titleKey: "table.addressAdjust",
            apply: (v: number) =>
              v === 0
                ? fail(
                    createMamepError({
                      code: "ADDRESS_ADJUST_UNDERFLOW",
                      category: "validation",
                      userMessageKey: "errors.addressAdjustUnderflow",
                      technicalMessage: "address 0 cannot be adjusted by -1",
                    }),
                  )
                : { ok: true as const, value: v - 1 },
            validate: () => ok(null),
          }
        : null,
  });
  return { host, clock, transport, device, events };
}

async function connect(
  h: Harness,
  profile = createDefaultRtuProfile(),
): Promise<boolean> {
  const result = await h.host.connect({
    profile,
    transport: h.transport,
    slaveAddress: 1,
    portLabel: "COM4",
  });
  return result.ok;
}

describe("RtuSessionHost 连接/断开", () => {
  it("connect 打开传输并进入 connected", async () => {
    const h = createHarness();
    expect(await connect(h)).toBe(true);
    expect(h.transport.opened).toBe(true);
    expect(h.host.getConnectionState()).toBe("connected");
    expect(h.host.getPortLabel()).toBe("COM4");
    expect(h.host.getProfile()).not.toBeNull();
  });

  it("connect 失败：返回错误并关闭传输（不残留端口占用）", async () => {
    const h = createHarness();
    const transport = new FakeTransport();
    // 打开失败：open 返回错误。
    transport.open = vi.fn(async () =>
      fail(
        createMamepError({
          code: "SERIAL_OPEN_FAILED",
          category: "transport",
          userMessageKey: "errors.serialOpenFailed",
          technicalMessage: "open failed",
        }),
      ),
    );
    const result = await h.host.connect({
      profile: createDefaultRtuProfile(),
      transport,
      slaveAddress: 1,
      portLabel: null,
    });
    expect(result.ok).toBe(false);
    expect(transport.closed).toBe(true);
    expect(h.host.getConnectionState()).toBe("disconnected");
  });

  it("disconnect 关闭传输并回到 disconnected", async () => {
    const h = createHarness();
    await connect(h);
    const result = await h.host.disconnect();
    expect(result.ok).toBe(true);
    expect(h.transport.closed).toBe(true);
    expect(h.host.getConnectionState()).toBe("disconnected");
  });

  it("dispose 断开会话并清空状态", async () => {
    const h = createHarness();
    await connect(h);
    await h.host.dispose();
    expect(h.transport.closed).toBe(true);
    expect(h.host.getConnectionState()).toBe("disconnected");
    expect(h.host.getProfile()).toBeNull();
    expect(h.host.getPortLabel()).toBeNull();
  });
});

describe("RtuSessionHost 读/写", () => {
  it("readRow 经调度器读取 FC03 并返回设备寄存器值", async () => {
    const h = createHarness();
    await connect(h);
    h.device.setRegister(0x1000, 0x1234);
    const result = await h.host.readRow(makeRow(0x1000));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x1234);
  });

  it("writeRow 经调度器写入 FC0x10 并更新设备寄存器", async () => {
    const h = createHarness();
    await connect(h);
    const result = await h.host.writeRow(makeRow(0x1000, "04D2"));
    expect(result.ok).toBe(true);
    expect(h.device.getRegister(0x1000)).toBe(0x04d2);
  });

  it("writeRow + writeVerify immediate：写后 FC03 回读一致 → verify-matched", async () => {
    const h = createHarness();
    await connect(h);
    const row = makeRow(0x1000, "04D2");
    const result = await h.host.writeRow(row, {
      writeVerify: { mode: "immediate", delayMs: null },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        kind: "write-succeeded-verify-matched",
        readValues: [0x04d2],
      });
    }
    expect(h.device.getRegister(0x1000)).toBe(0x04d2);
  });

  it("writeRow + writeVerify OFF：不回读 → no-verify", async () => {
    const h = createHarness();
    await connect(h);
    const row = makeRow(0x1000, "04D2");
    const result = await h.host.writeRow(row, {
      writeVerify: { mode: "off", delayMs: null },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: "write-succeeded-no-verify" });
    }
  });

  it("Address Adjust ON：用户地址 1 发送到 0（发送 = 用户 − 1）", async () => {
    const h = createHarness();
    await connect(h);
    h.host.setAddressTransform({
      transformId: "builtin.address-adjust",
      enabled: true,
    });
    h.device.setRegister(0, 0x00aa);
    const result = await h.host.readRow(makeRow(1));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x00aa);
  });

  it("Address Adjust ON 且用户地址 0：下溢报错（不回绕）", async () => {
    const h = createHarness();
    await connect(h);
    h.host.setAddressTransform({
      transformId: "builtin.address-adjust",
      enabled: true,
    });
    const result = await h.host.readRow(makeRow(0));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ADDRESS_ADJUST_UNDERFLOW");
  });

  it("未连接时 readRow 返回 not connected", async () => {
    const h = createHarness();
    const result = await h.host.readRow(makeRow(0x1000));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONNECTION_NOT_CONNECTED");
  });
});

describe("RtuSessionHost 全表读取", () => {
  it("readAllRows 批量读取并经 onPollResult 上报每行结果", async () => {
    const h = createHarness();
    await connect(h);
    h.device.setRegister(1, 0x1111);
    h.device.setRegister(2, 0x2222);
    const handle = h.host.readAllRows([
      { key: "a", sheetId: "sheet-a", address: 1 },
      { key: "b", sheetId: "sheet-a", address: 2 },
    ]);
    const summary = await handle.promise;
    expect(summary.ok).toBe(true);
    expect(h.events.onPollResult).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "a",
        sheetId: "sheet-a",
        address: 1,
        result: expect.objectContaining({ ok: true }),
      }),
    );
    expect(h.events.onPollResult).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "b",
        sheetId: "sheet-a",
        address: 2,
        result: expect.objectContaining({ ok: true }),
      }),
    );
  });

  it("readAllRows(rows, batchId)：汇总 batchId 与传入一致（远程路径，ADR-025）", async () => {
    const h = createHarness();
    await connect(h);
    h.device.setRegister(1, 0x1111);
    const handle = h.host.readAllRows(
      [{ key: "a", sheetId: "sheet-a", address: 1 }],
      "batch-xyz",
    );
    const summary = await handle.promise;
    expect(summary.ok).toBe(true);
    if (summary.ok) expect(summary.value.batchId).toBe("batch-xyz");
  });

  it("cancelBatch 取消排队未发送的行：cancelledCount 计入、在飞行完成", async () => {
    const h = createHarness();
    await connect(h);
    h.device.setRegister(1, 0x1111);
    const handle = h.host.readAllRows(
      [
        { key: "a", sheetId: "sheet-a", address: 1 },
        { key: "b", sheetId: "sheet-a", address: 2 },
        { key: "c", sheetId: "sheet-a", address: 3 },
      ],
      "batch-cancel-1",
    );
    // 第一行已入执行（在飞）；取消令牌使后续排队行取消（语义与本地路径一致）。
    h.host.cancelBatch("batch-cancel-1");
    const summary = await handle.promise;
    expect(summary.ok).toBe(true);
    if (summary.ok) {
      expect(summary.value.successCount + summary.value.cancelledCount).toBe(3);
      expect(summary.value.cancelledCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("cancelBatch 未知 batchId / 已完成批任务为安全 no-op", async () => {
    const h = createHarness();
    await connect(h);
    h.device.setRegister(1, 0x1111);
    const handle = h.host.readAllRows(
      [{ key: "a", sheetId: "sheet-a", address: 1 }],
      "batch-done",
    );
    await handle.promise;
    // 完成后登记已注销：不抛错、无副作用。
    expect(() => h.host.cancelBatch("batch-done")).not.toThrow();
    expect(() => h.host.cancelBatch("unknown-batch")).not.toThrow();
  });
});

describe("RtuSessionHost WP 轮询 / TM 追踪", () => {
  it("updatePollingTargets + startPolling 连续产生轮询结果（间隔 0）", async () => {
    const h = createHarness();
    await connect(h);
    h.device.setRegister(0x2000, 0xabcd);
    h.host.updatePollingTargets([
      { key: "row-a", sheetId: "sheet-a", address: 0x2000 },
    ]);
    h.host.startPolling();
    h.clock.advance(100);
    await flushMicrotasks();
    expect(h.events.onPollResult).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "row-a",
        sheetId: "sheet-a",
        address: 0x2000,
        result: expect.objectContaining({ ok: true, value: 0xabcd }),
      }),
    );
    h.host.stopPolling();
  });

  it("skips polling targets with an incompatible protocol and warns once", async () => {
    const h = createHarness();
    await connect(h);
    h.host.updatePollingTargets([
      {
        key: "compatible",
        sheetId: "sheet-compatible",
        address: 0x1000,
        route: { unitAddress: 1, protocol: "rtu" },
      },
      {
        key: "codec",
        sheetId: "sheet-codec",
        address: 0x2000,
        route: { unitAddress: 2, protocol: "plugin-codec" },
      },
    ]);
    h.host.startPolling();
    h.clock.advance(100);
    await flushMicrotasks();
    expect(h.transport.sentFrames).toHaveLength(1);
    expect(h.transport.sentFrames[0]?.[0]).toBe(1);
    h.host.stopPolling();
    h.host.updatePollingTargets([
      {
        key: "compatible",
        sheetId: "sheet-compatible",
        address: 0x1000,
        route: { unitAddress: 1, protocol: "rtu" },
      },
      {
        key: "codec",
        sheetId: "sheet-codec",
        address: 0x2000,
        route: { unitAddress: 2, protocol: "plugin-codec" },
      },
    ]);
    expect(
      h.events.onMessage.mock.calls.filter(
        ([message]) =>
          message.messageKey === "messages.requestRouteProtocolSkipped",
      ),
    ).toHaveLength(1);
    expect(h.events.onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: "messages.requestRouteProtocolSkipped",
        params: { protocols: "plugin-codec" },
      }),
    );
  });

  it("rejects a whole-table read before sending when its protocol is incompatible", async () => {
    const h = createHarness();
    await connect(h);
    const handle = h.host.readAllRows(
      [{ key: "a", sheetId: "sheet-a", address: 0x1000 }],
      "batch-mismatch",
      { unitAddress: 2, protocol: "plugin-codec" },
    );
    const result = await handle.promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("REQUEST_ROUTE_PROTOCOL_MISMATCH");
    }
    expect(h.transport.sentFrames).toHaveLength(0);
  });

  it("does not start Trace for a target with an incompatible protocol", async () => {
    const h = createHarness();
    await connect(h);
    h.host.traceStart("row-codec", 0x1000, 100, 1, {
      unitAddress: 2,
      protocol: "plugin-codec",
    });
    h.clock.advance(500);
    await flushMicrotasks();
    expect(h.transport.sentFrames).toHaveLength(0);
  });

  it("写入+回读期间暂缓同一行轮询（§18.3），完成后恢复", async () => {
    const h = createHarness();
    await connect(h);
    h.device.setRegister(0x2000, 0x1234);
    const row = makeRow(0x2000, "1234");
    // 写入行 rowId 与轮询 key 一致，才能被 defer 暂缓。
    (row as unknown as { rowId: string }).rowId = "row-a";
    h.host.updatePollingTargets([
      { key: "row-a", sheetId: "sheet-a", address: 0x2000 },
    ]);
    h.host.startPolling();
    // 先消费一轮正常轮询结果。
    h.clock.advance(100);
    await flushMicrotasks();
    h.events.onPollResult.mockClear();

    // 延迟回读窗口（500ms）内分步推进（链式定时器需逐步触发）：row-a 应被暂缓。
    const promise = h.host.writeRow(row, {
      writeVerify: { mode: "delayed", delayMs: 500 },
    });
    for (let t = 0; t < 300; t += 50) {
      h.clock.advance(50);
      await flushMicrotasks();
    }
    expect(h.events.onPollResult).not.toHaveBeenCalled();

    // 继续分步推进直到写入+回读完成，之后轮询恢复。
    for (let t = 0; t < 900; t += 50) {
      h.clock.advance(50);
      await flushMicrotasks();
    }
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        kind: "write-succeeded-verify-matched",
        readValues: [0x1234],
      });
    }
    expect(h.events.onPollResult).toHaveBeenCalled();
    h.host.stopPolling();
  });

  it("traceStart 按 Speed 间隔产生追踪样本", async () => {
    const h = createHarness();
    await connect(h);
    h.device.setRegister(0x3000, 0x55aa);
    h.host.traceStart("row-b", 0x3000, 100);
    h.clock.advance(100);
    await flushMicrotasks();
    expect(h.events.onTraceSample).toHaveBeenCalledWith(
      expect.objectContaining({ key: "row-b", rawValue: 0x55aa, sequence: 1 }),
    );
    h.host.traceStop("row-b");
  });

  it("setSlaveAddress 影响后续请求的从站地址", async () => {
    const h = createHarness();
    await connect(h);
    h.host.setSlaveAddress(7);
    h.device.setRegister(0x1000, 0x0001);
    const result = await h.host.readRow(makeRow(0x1000));
    expect(result.ok).toBe(true);
    // 发送帧首字节应为 0x07。
    const lastFrame = h.transport.sentFrames.at(-1);
    expect(lastFrame?.[0]).toBe(0x07);
  });
});

describe("RtuSessionHost 设备拔出策略", () => {
  it("传输错误 → interrupted：停止轮询/追踪并上报消息", async () => {
    const h = createHarness();
    await connect(h);
    h.host.updatePollingTargets([
      { key: "row-a", sheetId: "sheet-a", address: 1 },
    ]);
    h.host.startPolling();
    h.device.setRegister(1, 0x0001);

    h.transport.simulateError(
      createMamepError({
        code: "SERIAL_DEVICE_DISCONNECTED",
        category: "transport",
        userMessageKey: "errors.serialDeviceDisconnected",
        technicalMessage: "device unplugged",
      }),
    );

    expect(h.events.onStateChange).toHaveBeenCalledWith("interrupted");
    expect(h.events.onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        messageKey: "messages.deviceDisconnected",
      }),
    );
    // 拔出后轮询停止：推进时钟不应再有轮询结果。
    const before = h.events.onPollResult.mock.calls.length;
    h.clock.advance(1000);
    await flushMicrotasks();
    expect(h.events.onPollResult.mock.calls.length).toBe(before);
  });
});
