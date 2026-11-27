import { describe, expect, it, vi } from "vitest";
import {
  createCodecRegistry,
  type ProtocolCodec,
  type CommunicationLogEvent,
} from "@mamep2026/communication";
import {
  createDefaultTcpProfile,
  createEmptyRow,
  ok,
  RegisterAddress,
  type AddressTransform,
  type RequestRoute,
} from "@mamep2026/domain";
import { FakeTransport, VirtualClock } from "@mamep2026/test-kit";
import { TcpSessionHost } from "./tcp-session-host";

// A test-only MBAP codec uses distinct function bytes; it cannot pass as RTU.
function codec(): ProtocolCodec {
  let transaction = 0;
  return {
    protocolId: "test-tcp",
    transport: "tcp",
    maxRead: 2,
    maxWrite: 2,
    encodeRead: ({ slaveAddress, addresses }) =>
      Uint8Array.from([
        0,
        ++transaction,
        0,
        0,
        0,
        6,
        slaveAddress,
        65,
        0,
        addresses[0] ?? 0,
        0,
        addresses.length,
      ]),
    encodeWrite: ({ slaveAddress, entries }) =>
      Uint8Array.from([
        0,
        ++transaction,
        0,
        0,
        0,
        6,
        slaveAddress,
        66,
        0,
        entries[0]?.address ?? 0,
        0,
        entries[0]?.value ?? 0,
      ]),
    decodeResponse: () => ok({ kind: "write" }),
    parserFactory: (expected) => ({
      push: (frame) => ({
        done: true,
        frame,
        outcome:
          expected.kind === "read"
            ? ok({
                kind: "read",
                values: expected.request.addresses.map(() => 42),
              })
            : ok({ kind: "write" }),
      }),
    }),
    expectedLength: () => ({ normal: 12, exception: 9 }),
  };
}

async function flush() {
  for (let tick = 0; tick < 30; tick++) await Promise.resolve();
}

function harness() {
  const registry = createCodecRegistry();
  const scope = registry.createScope("tcp-plugin");
  scope.register(codec());
  const clock = new VirtualClock();
  const transport = new FakeTransport();
  let transform: AddressTransform | null = {
    id: "offset",
    protocol: "tcp",
    pluginId: "mapping-plugin",
    apply: (address, parameters) =>
      ok(address + Number(parameters?.offset ?? 0)),
  };
  const events = {
    onLog: vi.fn<(event: CommunicationLogEvent) => void>(),
    onStateChange: vi.fn(),
    onPollResult: vi.fn(),
    onTraceSample: vi.fn(),
    onMessage: vi.fn(),
  };
  const host = new TcpSessionHost({
    clock,
    events,
    codecRegistry: registry,
    resolveAddressTransform: () => transform,
  });
  const profile = {
    ...createDefaultTcpProfile(),
    codecId: "test-tcp",
    unitId: 7,
    requestTimeoutMs: 20,
    retryCount: 1,
  };
  const row = createEmptyRow();
  row.cellText = "2A";
  const address = RegisterAddress.create(10);
  if (address.ok) row.addressValue = address.value;
  const route: RequestRoute = {
    unitAddress: 9,
    protocol: "test-tcp",
    addressTransform: {
      transformId: "offset",
      enabled: true,
      parameters: { offset: 3 },
    },
  };
  return {
    host,
    clock,
    transport,
    registry,
    scope,
    events,
    profile,
    row,
    route,
    connect: () => host.connect({ profile, transport, portLabel: "loopback" }),
    revokeTransform: () => {
      transform = null;
    },
    replaceTransform: (next: AddressTransform) => {
      transform = next;
    },
  };
}

describe("TCP plugin routes", () => {
  it("maps built-in TCP requests and rejects non-contiguous mapped ranges", async () => {
    const h = harness();
    h.profile.codecId = "tcp";
    const route = { ...h.route, protocol: "tcp" };
    await h.connect();
    const read = h.host.readRow(h.row, route);
    await flush();
    const request = h.transport.sentFrames[0];
    if (request === undefined) throw new Error("Missing TCP request");
    expect([...request.slice(6)]).toEqual([9, 3, 0, 13, 0, 1]);
    h.transport.simulateData(
      Uint8Array.from([
        request[0] ?? 0,
        request[1] ?? 0,
        0,
        0,
        0,
        5,
        9,
        3,
        2,
        0,
        42,
      ]),
    );
    expect(await read).toEqual(ok(42));
    expect(h.events.onLog).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "mapping-plugin",
        userAddress: 10,
        sentAddress: 13,
      }),
    );
    h.replaceTransform({
      id: "offset",
      protocol: "tcp",
      apply: (address) => ok(address * 2),
    });
    h.row.registerCount = 2;
    expect(await h.host.readRow(h.row, route)).toMatchObject({
      ok: false,
      error: { code: "ADDRESS_TRANSFORM_INVALID" },
    });
    expect(h.transport.sentFrames).toHaveLength(1);
    await h.host.dispose();
  });

  it("rejects absent and RTU codecs without opening the transport", async () => {
    const h = harness();
    h.profile.codecId = "missing";
    expect(await h.connect()).toMatchObject({
      ok: false,
      error: { code: "CODEC_NOT_FOUND" },
    });
    h.registry.register({
      ...codec(),
      protocolId: "old-rtu",
      transport: "rtu",
    });
    h.profile.codecId = "old-rtu";
    expect(await h.connect()).toMatchObject({
      ok: false,
      error: { code: "REQUEST_ROUTE_PROTOCOL_MISMATCH" },
    });
    expect(h.transport.isOpen()).toBe(false);
    await h.host.dispose();
  });

  it("retains parameters across delayed verification and cancels verification after mapping revocation", async () => {
    const h = harness();
    await h.connect();
    const parameters = { offset: 3 };
    const route = {
      ...h.route,
      addressTransform: { transformId: "offset", enabled: true, parameters },
    };
    const write = h.host.writeRow(
      h.row,
      { writeVerify: { mode: "delayed", delayMs: 10 } },
      route,
    );
    await flush();
    parameters.offset = 8;
    h.transport.simulateData(Uint8Array.of(42));
    await flush();
    h.clock.advance(10);
    await flush();
    expect(h.transport.sentFrames[1]?.[9]).toBe(13);
    h.transport.simulateData(Uint8Array.of(42));
    expect(await write).toMatchObject({
      ok: true,
      value: { kind: "write-succeeded-verify-matched" },
    });
    const revoked = h.host.writeRow(
      h.row,
      { writeVerify: { mode: "delayed", delayMs: 10 } },
      h.route,
    );
    await flush();
    h.transport.simulateData(Uint8Array.of(42));
    await flush();
    h.revokeTransform();
    h.clock.advance(10);
    await flush();
    expect(await revoked).toMatchObject({
      ok: true,
      value: { kind: "write-succeeded-verify-failed" },
    });
    expect(h.transport.sentFrames).toHaveLength(3);
    await h.host.dispose();
  });

  it("captures mapping parameters, unit ID and plugin ownership for reads and write verification", async () => {
    const h = harness();
    await h.connect();
    const pending = h.host.readRow(h.row, h.route);
    Object.assign(h.route, { addressTransform: null });
    await flush();
    expect([...(h.transport.sentFrames[0] ?? [])]).toEqual([
      0, 1, 0, 0, 0, 6, 9, 65, 0, 13, 0, 1,
    ]);
    h.transport.simulateData(Uint8Array.of(42));
    expect(await pending).toEqual(ok(42));
    expect(h.events.onLog).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "tcp-plugin",
        userAddress: 10,
        sentAddress: 13,
      }),
    );
    const write = h.host.writeRow(
      h.row,
      { writeVerify: { mode: "immediate", delayMs: null } },
      {
        ...h.route,
        addressTransform: {
          transformId: "offset",
          enabled: true,
          parameters: { offset: 5 },
        },
      },
    );
    await flush();
    expect(h.transport.sentFrames[1]?.[9]).toBe(15);
    h.transport.simulateData(Uint8Array.of(42));
    await flush();
    expect(h.transport.sentFrames[2]?.[9]).toBe(15);
    h.transport.simulateData(Uint8Array.of(42));
    expect(await write).toMatchObject({
      ok: true,
      value: { kind: "write-succeeded-verify-matched" },
    });
    await h.host.dispose();
  });

  it("maps batch, polling and Trace requests and retains user addresses in results", async () => {
    const h = harness();
    await h.connect();
    const batch = h.host.readAllRows(
      [{ key: "row", sheetId: "sheet", address: 10 }],
      "batch",
      h.route,
    );
    await flush();
    expect(h.transport.sentFrames[0]?.[9]).toBe(13);
    h.transport.simulateData(Uint8Array.of(42));
    expect(await batch.promise).toMatchObject({
      ok: true,
      value: { successCount: 1 },
    });
    expect(h.events.onPollResult).toHaveBeenCalledWith(
      expect.objectContaining({ address: 10, route: h.route }),
    );
    h.host.updatePollingTargets([
      { key: "row", sheetId: "sheet", address: 20, route: h.route },
    ]);
    h.clock.advance(1);
    await flush();
    expect(h.transport.sentFrames[1]?.[9]).toBe(23);
    h.host.stopPolling();
    h.transport.simulateData(Uint8Array.of(42));
    await flush();
    h.host.traceStart("trace", 30, 5, 1, h.route);
    h.clock.advance(5);
    await flush();
    expect(h.transport.sentFrames.at(-1)?.[9]).toBe(33);
    h.transport.simulateData(Uint8Array.of(42));
    await flush();
    expect(h.events.onTraceSample).toHaveBeenCalledWith(
      expect.objectContaining({ address: 30, rawValue: 42 }),
    );
    await h.host.dispose();
  });

  it("rejects revoked queued and new work, ignores late responses and does not revive an old session", async () => {
    const h = harness();
    await h.connect();
    const first = h.host.readRow(h.row, h.route);
    const queued = h.host.readRow(h.row, h.route);
    await flush();
    h.scope.dispose();
    h.transport.simulateData(Uint8Array.of(42));
    h.clock.advance(20);
    await flush();
    expect(await first).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    expect(await queued).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    h.registry.createScope("tcp-plugin").register(codec());
    expect(await h.host.readRow(h.row, h.route)).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    expect(h.transport.sentFrames).toHaveLength(1);
    await h.host.dispose();
  });

  it("rejects missing transforms, invalid output and revoked mappings before a queued send", async () => {
    const h = harness();
    await h.connect();
    expect(
      await h.host.readRow(h.row, {
        ...h.route,
        addressTransform: {
          transformId: "offset",
          enabled: true,
          parameters: { offset: -11 },
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "ADDRESS_TRANSFORM_INVALID" },
    });
    const first = h.host.readRow(h.row, h.route);
    const queued = h.host.readRow(h.row, h.route);
    await flush();
    h.revokeTransform();
    h.transport.simulateData(Uint8Array.of(42));
    await flush();
    expect(await first).toMatchObject({ ok: false });
    expect(await queued).toMatchObject({ ok: false });
    expect(await h.host.readRow(h.row, h.route)).toMatchObject({
      ok: false,
      error: { code: "ADDRESS_TRANSFORM_INVALID" },
    });
    expect(h.transport.sentFrames).toHaveLength(1);
    await h.host.dispose();
  });

  it("retries with the captured mapping and reports timeout; cancellation stops queued batch work", async () => {
    const h = harness();
    await h.connect();
    const pending = h.host.readRow(h.row, h.route);
    await flush();
    h.clock.advance(20);
    await flush();
    expect(h.transport.sentFrames[1]?.[9]).toBe(13);
    expect(h.transport.sentFrames[1]?.[1]).toBe(2);
    h.clock.advance(20);
    await flush();
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: "REQUEST_TIMEOUT" },
    });
    const batch = h.host.readAllRows(
      [10, 20].map((address) => ({
        key: String(address),
        sheetId: "sheet",
        address,
      })),
      "cancel",
      h.route,
    );
    await flush();
    batch.cancel();
    h.transport.simulateData(Uint8Array.of(42));
    await flush();
    expect(await batch.promise).toMatchObject({
      ok: true,
      value: { successCount: 1, cancelledCount: 1 },
    });
    expect(h.transport.sentFrames).toHaveLength(3);
    await h.host.dispose();
  });
});
