import { describe, expect, it, vi } from "vitest";
import {
  createDefaultTcpProfile,
  createEmptyRow,
  RegisterAddress,
  ok,
} from "@mamep2026/domain";
import type { TransportPort } from "@mamep2026/communication";
import { NodePlatformHost } from "@mamep2026/platform-node";
import { VscodeSessionHost } from "./session-host";

async function flush(): Promise<void> {
  for (let step = 0; step < 20; step++) await Promise.resolve();
}

function harness() {
  const listeners = new Set<(bytes: Uint8Array) => void>();
  const sent: Uint8Array[] = [];
  const transport: TransportPort = {
    kind: "fake",
    open: async () => ok(undefined),
    close: async () => ok(undefined),
    isOpen: () => true,
    write: async (bytes) => {
      sent.push(bytes);
      return ok(undefined);
    },
    onData: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onError: () => () => {},
    onClose: () => () => {},
  };
  const platform = new NodePlatformHost({
    clock: { now: () => 0, schedule: () => ({ cancel() {} }) },
  });
  vi.spyOn(platform, "openTcpTransport").mockResolvedValue(ok(transport));
  const host = new VscodeSessionHost({
    platform,
    events: {
      onLog: vi.fn(),
      onStateChange: vi.fn(),
      onPollResult: vi.fn(),
      onTraceSample: vi.fn(),
      onMessage: vi.fn(),
    },
  });
  return {
    host,
    sent,
    respond(pdu: number[]) {
      const request = sent.at(-1);
      if (request === undefined) throw new Error("no request sent");
      const response = Uint8Array.from([
        request[0] ?? 0,
        request[1] ?? 0,
        0,
        0,
        0,
        pdu.length + 1,
        request[6] ?? 0,
        ...pdu,
      ]);
      for (const listener of listeners) listener(response);
    },
  };
}

function row() {
  const row = createEmptyRow();
  const address = RegisterAddress.create(10);
  if (!address.ok) throw new Error("invalid fixture address");
  row.addressValue = address.value;
  row.cellText = "1";
  return row;
}

describe("VscodeSessionHost core TCP table wiring", () => {
  it.each([
    ["coil", 1, [1, 1, 1], 1],
    ["discrete-input", 2, [2, 1, 1], 1],
    ["input-register", 4, [4, 2, 0xab, 0xcd], 0xabcd],
  ] as const)(
    "routes %s through the shared TCP session",
    async (table, fc, pdu, value) => {
      const h = harness();
      try {
        expect((await h.host.connectTcp(createDefaultTcpProfile())).ok).toBe(
          true,
        );
        const result = h.host.readRow(row(), {
          protocol: `modbus-basic-tables:${table}`,
          unitAddress: 255,
        });
        await flush();
        expect([...(h.sent[0] ?? [])]).toEqual([
          0,
          0,
          0,
          0,
          0,
          6,
          255,
          fc,
          0,
          10,
          0,
          1,
        ]);
        h.respond([...pdu]);
        expect(await result).toEqual({ ok: true, value });
      } finally {
        await h.host.dispose();
      }
    },
  );

  it("writes coils and rejects both read-only tables before transport", async () => {
    const h = harness();
    try {
      await h.host.connectTcp(createDefaultTcpProfile());
      for (const table of ["discrete-input", "input-register"]) {
        expect(
          await h.host.writeRow(row(), undefined, {
            protocol: `modbus-basic-tables:${table}`,
            unitAddress: 7,
          }),
        ).toMatchObject({
          ok: false,
          error: { code: "BASIC_TABLES_READ_ONLY" },
        });
      }
      expect(h.sent).toHaveLength(0);
      const write = h.host.writeRow(row(), undefined, {
        protocol: "modbus-basic-tables:coil",
        unitAddress: 7,
      });
      await flush();
      expect([...(h.sent[0] ?? [])]).toEqual([
        0, 0, 0, 0, 0, 8, 7, 15, 0, 10, 0, 1, 1, 1,
      ]);
      h.respond([15, 0, 10, 0, 1]);
      expect(await write).toEqual({
        ok: true,
        value: { kind: "write-succeeded-no-verify" },
      });
    } finally {
      await h.host.dispose();
    }
  });
});
