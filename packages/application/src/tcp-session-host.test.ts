/**
 * TcpSessionHost 单测（packages/application，Application 层）。
 * 覆盖：TCP 连接/断开、FC03 读 / FC0x10 写（MBAP 帧、unitId 透传、Transaction ID）、
 * WP 轮询/追踪恢复、设备拔出策略（interrupted → 消息）、dispose 释放。
 * 传输注入 test-kit FakeTransport（手动 simulateData 响应 TCP 帧），虚拟时钟驱动调度。
 */
import { describe, expect, it, vi } from "vitest";
import { TcpSessionHost } from "./tcp-session-host";
import type { SessionHostEvents } from "./session-host-core";
import type {
  CommunicationLogEvent,
  ConnectionState,
  TraceSample,
  TransportPort,
} from "@mamep2026/communication";
import {
  createDefaultTcpProfile,
  createEmptyRow,
  createMamepError,
  fail,
  ok,
  RegisterAddress,
  type RegisterRow,
  type Result,
  type TcpConnectionProfile,
} from "@mamep2026/domain";
import type { ApplicationMessage } from "@mamep2026/logging";
import { FakeTransport, VirtualClock } from "@mamep2026/test-kit";

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

type MockedEvent = ReturnType<typeof vi.fn>;

interface Harness {
  host: TcpSessionHost;
  clock: VirtualClock;
  transport: FakeTransport;
  events: Record<keyof SessionHostEvents, MockedEvent>;
  profile: TcpConnectionProfile;
}

function makeRow(address: number, cellText = ""): RegisterRow {
  const row = createEmptyRow();
  const parsed = RegisterAddress.create(address);
  row.addressValue = parsed.ok ? parsed.value : null;
  row.cellText = cellText;
  return row;
}

/** 组 MBAP 帧（不含 CRC）。 */
function tcpFrame(tid: number, unitId: number, pdu: Uint8Array): Uint8Array {
  const length = 1 + pdu.length;
  const frame = new Uint8Array(6 + length);
  frame[0] = (tid >> 8) & 0xff;
  frame[1] = tid & 0xff;
  frame[4] = (length >> 8) & 0xff;
  frame[5] = length & 0xff;
  frame[6] = unitId;
  frame.set(pdu, 7);
  return frame;
}

function readResponse(tid: number, unitId: number, value: number): Uint8Array {
  return tcpFrame(
    tid,
    unitId,
    Uint8Array.from([0x03, 0x02, (value >> 8) & 0xff, value & 0xff]),
  );
}

function writeResponse(
  tid: number,
  unitId: number,
  address: number,
): Uint8Array {
  return tcpFrame(
    tid,
    unitId,
    Uint8Array.from([0x10, (address >> 8) & 0xff, address & 0xff, 0x00, 0x01]),
  );
}

function createHarness(unitId = 0): Harness {
  const clock = new VirtualClock();
  const transport = new FakeTransport();
  const events: Record<keyof SessionHostEvents, MockedEvent> = {
    onLog: vi.fn<(event: CommunicationLogEvent) => void>(),
    onStateChange: vi.fn<(state: ConnectionState) => void>(),
    onPollResult:
      vi.fn<(key: string, address: number, result: Result<number>) => void>(),
    onTraceSample: vi.fn<(sample: TraceSample) => void>(),
    onMessage: vi.fn<(message: ApplicationMessage) => void>(),
  };
  const profile = createDefaultTcpProfile("PLC-502");
  profile.unitId = unitId;
  const host = new TcpSessionHost({
    clock,
    events: events as SessionHostEvents,
  });
  return { host, clock, transport, events, profile };
}

async function connect(h: Harness): Promise<boolean> {
  const result = await h.host.connect({
    profile: h.profile,
    transport: h.transport,
    portLabel: "127.0.0.1:502",
  });
  return result.ok;
}

describe("TCP basic table operations", () => {
  const route = { protocol: "modbus-basic-tables:coil", unitAddress: 7 };

  it("preserves the coil route through FC0F write and FC01 verification", async () => {
    const h = createHarness();
    await connect(h);
    const result = h.host.writeRow(
      makeRow(10, "1"),
      { writeVerify: { mode: "immediate", delayMs: null } },
      route,
    );
    await flushMicrotasks();
    expect(h.transport.sentFrames[0]?.[7]).toBe(15);
    h.transport.simulateData(
      tcpFrame(0, 7, Uint8Array.from([15, 0, 10, 0, 1])),
    );
    await flushMicrotasks(30);
    expect(h.transport.sentFrames[1]?.[7]).toBe(1);
    expect(h.transport.sentFrames[1]?.[6]).toBe(7);
    h.transport.simulateData(tcpFrame(1, 7, Uint8Array.from([1, 1, 1])));
    expect(await result).toEqual({
      ok: true,
      value: { kind: "write-succeeded-verify-matched", readValues: [1] },
    });
    await h.host.dispose();
  });

  it("accepts basic table batches and retains route context in row results", async () => {
    const h = createHarness();
    await connect(h);
    const batch = h.host.readAllRows(
      [{ key: "row-a", sheetId: "sheet-a", address: 10 }],
      "basic-batch",
      route,
    );
    await flushMicrotasks();
    expect(h.transport.sentFrames[0]?.[7]).toBe(1);
    h.transport.simulateData(tcpFrame(0, 7, Uint8Array.from([1, 1, 1])));
    expect(await batch.promise).toMatchObject({
      ok: true,
      value: { successCount: 1, failureCount: 0 },
    });
    expect(h.events.onPollResult).toHaveBeenCalledWith(
      expect.objectContaining({ route, result: { ok: true, value: 1 } }),
    );
    await h.host.dispose();
  });

  it("accepts basic table polling and trace routes without enabling RTU plugins", async () => {
    const h = createHarness();
    await connect(h);
    h.host.updatePollingTargets([
      { key: "coil", sheetId: "sheet-a", address: 10, route },
    ]);
    h.host.startPolling();
    h.clock.advance(0);
    await flushMicrotasks();
    expect(h.transport.sentFrames[0]?.[7]).toBe(1);
    h.transport.simulateData(tcpFrame(0, 7, Uint8Array.from([1, 1, 1])));
    await flushMicrotasks(30);
    h.host.stopPolling();
    expect(h.events.onPollResult).toHaveBeenCalledWith(
      expect.objectContaining({ route }),
    );
    h.host.traceStart("input", 20, 100, 1, {
      protocol: "modbus-basic-tables:input-register",
      unitAddress: 255,
    });
    h.clock.advance(100);
    await flushMicrotasks(30);
    const sent = h.transport.sentFrames.at(-1);
    expect(sent?.[7]).toBe(4);
    h.transport.simulateData(
      tcpFrame(sent?.[1] ?? 0, 255, Uint8Array.from([4, 2, 0, 42])),
    );
    await flushMicrotasks(30);
    expect(h.events.onTraceSample).toHaveBeenCalled();
    expect(
      await h.host.readRow(makeRow(10), {
        protocol: "yaskawa-memobus",
        unitAddress: 7,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REQUEST_ROUTE_PROTOCOL_MISMATCH" },
    });
    await h.host.dispose();
  });
});

describe("TcpSessionHost 连接/断开", () => {
  it("connect 打开传输并进入 connected", async () => {
    const h = createHarness();
    expect(await connect(h)).toBe(true);
    expect(h.transport.opened).toBe(true);
    expect(h.host.getConnectionState()).toBe("connected");
    expect(h.host.getPortLabel()).toBe("127.0.0.1:502");
    expect(h.host.getProfile()?.protocol).toBe("tcp");
  });

  it("disconnect 关闭传输并回到 disconnected", async () => {
    const h = createHarness();
    await connect(h);
    const result = await h.host.disconnect();
    expect(result.ok).toBe(true);
    expect(h.transport.closed).toBe(true);
    expect(h.host.getConnectionState()).toBe("disconnected");
  });
});

describe("TcpSessionHost 读/写", () => {
  it("readRow 发送 TCP 请求（unitId 透传）并解析响应", async () => {
    const h = createHarness(5);
    await connect(h);
    const row = makeRow(0x0001, "");
    const promise = h.host.readRow(row);
    await flushMicrotasks();
    expect(h.transport.sentFrames).toHaveLength(1);
    const sent = h.transport.sentFrames[0] ?? new Uint8Array();
    // MBAP：tid=0（首请求）、unit=5、FC03。
    expect(sent[0]).toBe(0);
    expect(sent[1]).toBe(0);
    expect(sent[6]).toBe(5);
    expect(sent[7]).toBe(0x03);
    h.transport.simulateData(readResponse(0, 5, 0xabcd));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0xabcd);
  });

  it("writeRow 发送 FC0x10 请求并解析写响应", async () => {
    const h = createHarness(0);
    await connect(h);
    const row = makeRow(0x0002, "1234");
    const promise = h.host.writeRow(row);
    await flushMicrotasks();
    const sent = h.transport.sentFrames[0] ?? new Uint8Array();
    expect(sent[7]).toBe(0x10);
    expect(sent[6]).toBe(0);
    h.transport.simulateData(writeResponse(0, 0, 0x0002));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: "write-succeeded-no-verify" });
    }
  });

  it("setUnitId 动态更新 Unit ID：后续请求帧 unit 字节变化", async () => {
    const h = createHarness(3);
    await connect(h);

    // 会话内动态修改 Unit ID 为 9（已知限制打通）。
    h.host.setUnitId(9);
    const row = makeRow(0x0001, "");
    const promise = h.host.readRow(row);
    await flushMicrotasks();
    const sent = h.transport.sentFrames[0] ?? new Uint8Array();
    expect(sent[6]).toBe(9);
    expect(sent[7]).toBe(0x03);

    // 响应匹配新 Unit ID 才被接受。
    h.transport.simulateData(readResponse(0, 9, 0x0055));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0x0055);
  });

  it("设备拔出（interrupted）停止轮询/追踪并上报消息", async () => {
    const h = createHarness(0);
    await connect(h);
    // 开启轮询与追踪。
    h.host.updatePollingTargets([
      { key: "row-a", sheetId: "sheet-a", address: 0x0001 },
    ]);
    h.host.startPolling();
    h.host.traceStart("row-a", 0x0001, 500);
    // 模拟连接中断。
    h.transport.simulateClose();
    await flushMicrotasks();
    expect(h.host.getConnectionState()).toBe("interrupted");
    const msg = h.events.onMessage.mock.calls.find(
      (call) => call[0]?.messageKey === "messages.deviceDisconnected",
    );
    expect(msg).toBeDefined();
  });

  it("dispose 断开会话并清空状态", async () => {
    const h = createHarness(0);
    await connect(h);
    await h.host.dispose();
    expect(h.host.getConnectionState()).toBe("disconnected");
    expect(h.host.getProfile()).toBeNull();
    expect(h.host.getPortLabel()).toBeNull();
  });
});

describe("TcpSessionHost 自动重连（ReconnectCoordinator 集成）", () => {
  interface ReconnectHarness {
    host: TcpSessionHost;
    clock: VirtualClock;
    events: Record<keyof SessionHostEvents, MockedEvent>;
    opened: FakeTransport[];
    openTransport: ReturnType<typeof vi.fn>;
    profile: TcpConnectionProfile;
  }

  function createReconnectHarness(): ReconnectHarness {
    const clock = new VirtualClock();
    const events: Record<keyof SessionHostEvents, MockedEvent> = {
      onLog: vi.fn<(event: CommunicationLogEvent) => void>(),
      onStateChange: vi.fn<(state: ConnectionState) => void>(),
      onPollResult:
        vi.fn<(key: string, address: number, result: Result<number>) => void>(),
      onTraceSample: vi.fn<(sample: TraceSample) => void>(),
      onMessage: vi.fn<(message: ApplicationMessage) => void>(),
    };
    const profile = createDefaultTcpProfile("PLC-502");
    profile.autoReconnect = true;
    const opened: FakeTransport[] = [];
    const openTransport = vi.fn(async (): Promise<Result<TransportPort>> => {
      const transport = new FakeTransport();
      opened.push(transport);
      return ok(transport);
    });
    const host = new TcpSessionHost({
      clock,
      events: events as SessionHostEvents,
      openTransport,
    });
    return { host, clock, events, opened, openTransport, profile };
  }

  async function connectReconnect(h: ReconnectHarness): Promise<FakeTransport> {
    const first = new FakeTransport();
    const result = await h.host.connect({
      profile: h.profile,
      transport: first,
      portLabel: "127.0.0.1:502",
    });
    expect(result.ok).toBe(true);
    return first;
  }

  it("interrupted 后自动重连成功：状态序列 + 轮询恢复 + 无失败消息", async () => {
    const h = createReconnectHarness();
    const first = await connectReconnect(h);
    h.host.updatePollingTargets([
      { key: "row-a", sheetId: "sheet-a", address: 0x0001 },
    ]);
    h.host.startPolling();

    // 对端断开 → interrupted → 自动进入 reconnect-waiting。
    first.simulateClose();
    await flushMicrotasks();
    expect(h.host.getConnectionState()).toBe("reconnect-waiting");

    // 推进退避 1000ms → reconnecting → openTransport 重建传输 → 重连成功。
    h.clock.advance(1000);
    await flushMicrotasks();
    expect(h.openTransport).toHaveBeenCalledTimes(1);
    expect(h.opened).toHaveLength(1);
    expect(h.host.getConnectionState()).toBe("connected");
    expect(
      h.events.onMessage.mock.calls.some(
        (call) => call[0]?.messageKey === "messages.reconnectFailed",
      ),
    ).toBe(false);

    // 轮询自动恢复：新传输上出现 FC03 请求。
    h.clock.advance(50);
    await flushMicrotasks();
    const frames = h.opened[0]?.sentFrames ?? [];
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]?.[7]).toBe(0x03);
  });

  it("autoReconnect=false 时不重连：停留在 interrupted", async () => {
    const h = createReconnectHarness();
    h.profile.autoReconnect = false;
    const first = await connectReconnect(h);
    first.simulateClose();
    await flushMicrotasks();
    expect(h.host.getConnectionState()).toBe("interrupted");
    h.clock.advance(10000);
    await flushMicrotasks();
    expect(h.openTransport).not.toHaveBeenCalled();
    expect(h.host.getConnectionState()).toBe("interrupted");
  });

  it("用户主动断开取消挂起重连，不再重连", async () => {
    const h = createReconnectHarness();
    const first = await connectReconnect(h);
    first.simulateClose();
    await flushMicrotasks();
    expect(h.host.getConnectionState()).toBe("reconnect-waiting");

    await h.host.disconnect();
    h.clock.advance(10000);
    await flushMicrotasks();
    expect(h.openTransport).not.toHaveBeenCalled();
    expect(h.host.getConnectionState()).toBe("disconnected");
  });

  it("重连等待期间用户发起新连接取消重连", async () => {
    const h = createReconnectHarness();
    const first = await connectReconnect(h);
    first.simulateClose();
    await flushMicrotasks();
    expect(h.host.getConnectionState()).toBe("reconnect-waiting");

    const second = new FakeTransport();
    const result = await h.host.connect({
      profile: h.profile,
      transport: second,
      portLabel: "127.0.0.1:502",
    });
    expect(result.ok).toBe(true);
    h.clock.advance(10000);
    await flushMicrotasks();
    expect(h.openTransport).not.toHaveBeenCalled();
    expect(h.host.getConnectionState()).toBe("connected");
  });

  it("重连失败达到上限转 failed 并上报消息", async () => {
    const h = createReconnectHarness();
    h.openTransport.mockImplementation(
      async (): Promise<Result<TransportPort>> =>
        fail(
          createMamepError({
            code: "TCP_CONNECT_FAILED",
            category: "connection",
            severity: "error",
            retryable: true,
            userMessageKey: "errors.tcpConnectFailed",
            technicalMessage: "open failed (fake)",
          }),
        ),
    );
    const first = await connectReconnect(h);
    first.simulateClose();
    await flushMicrotasks();
    expect(h.host.getConnectionState()).toBe("reconnect-waiting");

    // maxAttempts=5：1s/2s/4s/8s/15s(封顶) 五次 open 失败后转 failed。
    for (const delay of [1000, 2000, 4000, 8000, 15000]) {
      h.clock.advance(delay);
      await flushMicrotasks();
    }
    expect(h.host.getConnectionState()).toBe("failed");
    expect(
      h.events.onMessage.mock.calls.some(
        (call) => call[0]?.messageKey === "messages.reconnectFailed",
      ),
    ).toBe(true);
  });
});
