// Test-only MBAP protocol. No RTU CRC or vendor protocol is used.
export const manifest = {
  id: "tcp-routing-fixture",
  name: "TCP routing fixture",
  version: "1.0.0",
  apiVersion: "2.0",
  description: "TCP codec and address mapping regression",
  platform: { web: true, node: true },
  permissions: [],
  executionRequirements: {
    version: 1,
    requiredExecution: "same-process",
    reason: "Synchronous TCP codec fixture",
  },
  contributes: {
    protocolExtension: { protocolId: "fixture-tcp", titleKey: "TCP fixture" },
    tableType: {
      id: "registers",
      protocolId: "fixture-tcp",
      titleKey: "TCP fixture",
    },
    addressTransform: {
      id: "fixture.offset",
      protocol: "fixture-tcp",
      defaultConfig: { enabled: false, parameters: { offset: 5 } },
    },
  },
};

export function activate(ctx) {
  let transaction = 0;
  const frame = (unit, pdu) => {
    transaction = (transaction + 1) & 65535;
    return Uint8Array.from([
      transaction >> 8,
      transaction & 255,
      0,
      0,
      0,
      pdu.length + 1,
      unit,
      ...pdu,
    ]);
  };
  const codec = {
    protocolId: "fixture-tcp",
    transport: "tcp",
    maxRead: 2,
    maxWrite: 2,
    encodeRead: ({ slaveAddress, addresses }) =>
      frame(slaveAddress, [
        65,
        addresses[0] >> 8,
        addresses[0] & 255,
        0,
        addresses.length,
      ]),
    encodeWrite: ({ slaveAddress, entries }) =>
      frame(slaveAddress, [
        66,
        entries[0].address >> 8,
        entries[0].address & 255,
        0,
        entries.length,
        ...entries.flatMap(({ value }) => [value >> 8, value & 255]),
      ]),
    expectedLength: () => ({ normal: 10, exception: 9 }),
    decodeResponse: (bytes, expected) =>
      expected.kind === "read"
        ? {
            ok: true,
            value: {
              kind: "read",
              values: expected.request.addresses.map(
                (_, index) =>
                  (bytes[9 + index * 2] << 8) | bytes[10 + index * 2],
              ),
            },
          }
        : { ok: true, value: { kind: "write" } },
    parserFactory: (expected) => {
      const expectedTransaction = transaction;
      let pending = [];
      return {
        push: (chunk) => {
          pending.push(...chunk);
          while (pending.length >= 7) {
            const length = (pending[4] << 8) | pending[5];
            if (length < 2 || length > 254) {
              pending.shift();
              continue;
            }
            if (pending.length < length + 6) break;
            const bytes = Uint8Array.from(pending.splice(0, length + 6));
            if (
              ((bytes[0] << 8) | bytes[1]) !== expectedTransaction ||
              bytes[2] !== 0 ||
              bytes[3] !== 0 ||
              bytes[6] !== expected.request.slaveAddress
            )
              continue;
            const count =
              expected.kind === "read"
                ? expected.request.addresses.length
                : expected.request.entries.length;
            if (
              bytes[7] !== (expected.kind === "read" ? 65 : 66) ||
              bytes.length !== (expected.kind === "read" ? 9 + count * 2 : 8)
            )
              continue;
            return {
              done: true,
              frame: bytes,
              outcome: codec.decodeResponse(bytes, expected),
            };
          }
          return { done: false };
        },
      };
    },
  };
  const registered = ctx.registries.codec.register(codec);
  if (!registered.ok) throw new Error(registered.error.code);
  const transform = ctx.registries.addressTransform.register({
    id: "fixture.offset",
    protocol: "fixture-tcp",
    apply: (address, parameters) => ({
      ok: true,
      value: address + Number(parameters?.offset ?? 0),
    }),
  });
  if (!transform.ok) throw new Error(transform.error.code);
}
