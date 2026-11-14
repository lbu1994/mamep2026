import { describe, expect, it } from "vitest";
import type { RequestRoute, TcpConnectionProfile } from "@mamep2026/domain";
import { CommunicationSession } from "./session";
import { FakeTransport } from "./testing/fake-transport";
import { ManualClock, advanceUntil } from "./testing/manual-clock";

function profile(): TcpConnectionProfile {
  return {
    id: "route-test" as TcpConnectionProfile["id"],
    name: "route-test",
    protocol: "tcp",
    host: "127.0.0.1",
    port: 502,
    unitId: 1,
    connectTimeoutMs: 5000,
    requestTimeoutMs: 1000,
    retryCount: 1,
    autoReconnect: false,
  };
}

function makeSession() {
  const clock = new ManualClock();
  const transport = new FakeTransport();
  const session = new CommunicationSession({
    transport,
    clock,
    config: profile(),
    protocol: "tcp",
    unitId: 1,
  });
  return { clock, transport, session };
}

function tcpFrame(tid: number, unitId: number, pdu: Uint8Array): Uint8Array {
  const frame = new Uint8Array(7 + pdu.length);
  frame[0] = (tid >> 8) & 0xff;
  frame[1] = tid & 0xff;
  frame[4] = ((pdu.length + 1) >> 8) & 0xff;
  frame[5] = (pdu.length + 1) & 0xff;
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

describe("CommunicationSession request route snapshot", () => {
  it("keeps a queued read on its captured Unit ID after the current Unit ID changes", async () => {
    const { clock, transport, session } = makeSession();
    await session.connect();
    const route: RequestRoute = { unitAddress: 5, protocol: "tcp" };

    const first = session.readRegister(0x0001, {
      source: "manual-read",
      route,
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);

    const second = session.readRegister(0x0002, {
      source: "manual-read",
      route,
    });
    session.setUnitId(9);

    transport.simulateData(readResponse(0, 5, 0x1111));
    expect((await first).ok).toBe(true);
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    expect(transport.sentFrames[1]?.[6]).toBe(5);
    transport.simulateData(readResponse(1, 5, 0x2222));
    expect((await second).ok).toBe(true);

    const next = session.readRegister(0x0003, {
      source: "manual-read",
      route: { unitAddress: 9, protocol: "tcp" },
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 3);
    expect(transport.sentFrames[2]?.[6]).toBe(9);
    transport.simulateData(readResponse(2, 9, 0x3333));
    expect((await next).ok).toBe(true);
  });

  it("uses the same captured Unit ID for every retry attempt", async () => {
    const { clock, transport, session } = makeSession();
    await session.connect();
    const pending = session.readRegister(0x0001, {
      source: "manual-read",
      route: { unitAddress: 5, protocol: "tcp" },
    });

    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    session.setUnitId(9);
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    expect(transport.sentFrames[0]?.[6]).toBe(5);
    expect(transport.sentFrames[1]?.[6]).toBe(5);
    expect(transport.sentFrames[0]?.[1]).toBe(0);
    expect(transport.sentFrames[1]?.[1]).toBe(1);

    transport.simulateData(readResponse(1, 5, 0x0042));
    expect((await pending).ok).toBe(true);
  });

  it("keeps a queued write on its captured Unit ID after the current Unit ID changes", async () => {
    const { clock, transport, session } = makeSession();
    await session.connect();
    const route: RequestRoute = { unitAddress: 5, protocol: "tcp" };
    const first = session.writeRegister(0x0001, 0x1111, {
      source: "manual-write",
      route,
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    const second = session.writeRegister(0x0002, 0x2222, {
      source: "manual-write",
      route,
    });
    session.setUnitId(9);
    transport.simulateData(writeResponse(0, 5, 0x0001));
    expect((await first).ok).toBe(true);
    await advanceUntil(clock, () => transport.sentFrames.length === 2);
    expect(transport.sentFrames[1]?.[6]).toBe(5);
    transport.simulateData(writeResponse(1, 5, 0x0002));
    expect((await second).ok).toBe(true);
  });

  it("rejects a mismatched protocol before writing any frame", async () => {
    const { session, transport } = makeSession();
    await session.connect();
    const result = await session.readRegister(0x0001, {
      source: "manual-read",
      route: { unitAddress: 5, protocol: "codec-other" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("REQUEST_ROUTE_PROTOCOL_MISMATCH");
    }
    expect(transport.sentFrames).toHaveLength(0);
  });

  it("rejects an out-of-range Unit ID before writing any frame", async () => {
    const { session, transport } = makeSession();
    await session.connect();
    const result = await session.readRegister(0x0001, {
      source: "manual-read",
      route: { unitAddress: 256, protocol: "tcp" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("REQUEST_ROUTE_INVALID");
    expect(transport.sentFrames).toHaveLength(0);
  });
});
