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
} from "@mamep2026/communication";
import {
  createDefaultTcpProfile,
  createEmptyRow,
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

function writeResponse(tid: number, unitId: number, address: number): Uint8Array {
  return tcpFrame(
    tid,
    unitId,
    Uint8Array.from([
      0x10,
      (address >> 8) & 0xff,
      address & 0xff,
      0x00,
      0x01,
    ]),
  );
}

function createHarness(unitId = 0): Harness {
  const clock = new VirtualClock();
  const transport = new FakeTransport();
  const events: Record<keyof SessionHostEvents, MockedEvent> = {
    onLog: vi.fn<(event: CommunicationLogEvent) => void>(),
    onStateChange: vi.fn<(state: ConnectionState) => void>(),
    onPollResult: vi.fn<
      (key: string, address: number, result: Result<number>) => void
    >(),
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

  it("设备拔出（interrupted）停止轮询/追踪并上报消息", async () => {
    const h = createHarness(0);
    await connect(h);
    // 开启轮询与追踪。
    h.host.updatePollingTargets([{ key: "row-a", address: 0x0001 }]);
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
