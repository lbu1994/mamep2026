import { describe, expect, it } from "vitest";
import { appendCrc } from "@mamep2026/protocol-modbus";
import { MockTransport } from "./mock-transport";

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("MockTransport", () => {
  it("responds to FC03 reads with the stored register value", async () => {
    const transport = new MockTransport();
    await transport.open();
    transport.setRegister(0x0001, 0x1234);

    const received: Uint8Array[] = [];
    transport.onData((chunk) => received.push(chunk));

    await transport.write(
      appendCrc(Uint8Array.from([0x01, 0x03, 0x00, 0x01, 0x00, 0x01])),
    );
    await flush();

    expect(received).toHaveLength(1);
    expect(Array.from(received[0] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x03, 0x02, 0x12, 0x34]))),
    );
  });

  it("responds to FC0x10 writes and stores the value", async () => {
    const transport = new MockTransport();
    await transport.open();
    const received: Uint8Array[] = [];
    transport.onData((chunk) => received.push(chunk));

    await transport.write(
      appendCrc(
        Uint8Array.from([0x01, 0x10, 0x00, 0x02, 0x00, 0x01, 0x02, 0x00, 0x42]),
      ),
    );
    await flush();

    expect(transport.getRegister(0x0002)).toBe(0x42);
    expect(Array.from(received[0] ?? [])).toEqual(
      Array.from(
        appendCrc(Uint8Array.from([0x01, 0x10, 0x00, 0x02, 0x00, 0x01])),
      ),
    );
  });

  it("returns a Modbus exception for unsupported function codes", async () => {
    const transport = new MockTransport();
    await transport.open();
    const received: Uint8Array[] = [];
    transport.onData((chunk) => received.push(chunk));

    await transport.write(
      appendCrc(Uint8Array.from([0x01, 0x06, 0x00, 0x01, 0x00, 0x42])),
    );
    await flush();

    expect(Array.from(received[0] ?? [])).toEqual(
      Array.from(appendCrc(Uint8Array.from([0x01, 0x86, 0x01]))),
    );
  });
});
