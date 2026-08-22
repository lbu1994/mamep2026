import { describe, expect, it } from "vitest";
import { ScriptedModbusRtuDevice } from "@mamep2026/test-kit";
import { appendCrc } from "@mamep2026/protocol-modbus";
import { NodeSerialTransport } from "./node-serial-transport";
import { FakeSerialPort } from "./testing/fake-serial-port";

function makeTransport(): {
  fake: FakeSerialPort;
  transport: NodeSerialTransport;
} {
  const fake = new FakeSerialPort({ path: "COM4", baudRate: 9600 });
  const transport = new NodeSerialTransport(fake);
  return { fake, transport };
}

describe("NodeSerialTransport open", () => {
  it("opens and reports isOpen", async () => {
    const { fake, transport } = makeTransport();
    const result = await transport.open();
    expect(result.ok).toBe(true);
    expect(fake.isOpen).toBe(true);
    expect(transport.isOpen()).toBe(true);
  });

  it("maps open failure to a structured error", async () => {
    const { fake, transport } = makeTransport();
    fake.openError = Object.assign(new Error("access denied"), {
      code: "EACCES",
    });
    const result = await transport.open();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SERIAL_PERMISSION_DENIED");
    expect(transport.isOpen()).toBe(false);
  });

  it("maps unknown open failure to SERIAL_OPEN_FAILED", async () => {
    const { fake, transport } = makeTransport();
    fake.openError = new Error("mystery");
    const result = await transport.open();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SERIAL_OPEN_FAILED");
  });

  it("guards duplicate open", async () => {
    const { transport } = makeTransport();
    await transport.open();
    const result = await transport.open();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SERIAL_OPEN_FAILED");
  });
});

describe("NodeSerialTransport write", () => {
  it("fails with TRANSPORT_NOT_OPEN when not open", async () => {
    const { transport } = makeTransport();
    const result = await transport.write(Uint8Array.from([1, 2]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TRANSPORT_NOT_OPEN");
  });

  it("forwards bytes to the port when open", async () => {
    const { fake, transport } = makeTransport();
    await transport.open();
    const bytes = Uint8Array.from([0x01, 0x03, 0x00]);
    const result = await transport.write(bytes);
    expect(result.ok).toBe(true);
    expect(fake.sentFrames).toHaveLength(1);
    expect([...fake.sentFrames[0]!]).toEqual([0x01, 0x03, 0x00]);
  });

  it("maps write failure to a structured error", async () => {
    const { fake, transport } = makeTransport();
    await transport.open();
    fake.writeError = Object.assign(new Error("boom"), { code: "EIO" });
    const result = await transport.write(Uint8Array.from([1]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SERIAL_ERROR");
  });
});

describe("NodeSerialTransport data events", () => {
  it("delivers data chunks to onData listeners (fragmentation)", async () => {
    const { fake, transport } = makeTransport();
    await transport.open();
    const received: Uint8Array[] = [];
    transport.onData((chunk) => received.push(chunk));
    fake.simulateData(Uint8Array.from([0x01, 0x03]));
    fake.simulateData(Uint8Array.from([0x02]));
    fake.simulateData(new Uint8Array(0)); // 空数据不投递
    expect(received).toHaveLength(2);
  });

  it("round-trips an RTU request/response with a scripted device", async () => {
    const device = new ScriptedModbusRtuDevice();
    device.setRegister(0x0000, 0x1234);
    const { fake, transport } = makeTransport();
    fake.device = device;
    await transport.open();
    const received: Uint8Array[] = [];
    transport.onData((chunk) => received.push(chunk));
    const request = appendCrc(
      Uint8Array.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]),
    );
    const result = await transport.write(request);
    expect(result.ok).toBe(true);
    expect(received).toHaveLength(1);
    const expected = appendCrc(Uint8Array.from([0x01, 0x03, 0x02, 0x12, 0x34]));
    expect([...received[0]!]).toEqual([...expected]);
  });

  it("maps port errors to onError listeners while open", async () => {
    const { fake, transport } = makeTransport();
    await transport.open();
    const codes: string[] = [];
    transport.onError((error) => codes.push(error.code));
    const error = new Error("gone");
    error.name = "DisconnectedError";
    fake.simulateError(error);
    expect(codes).toEqual(["SERIAL_DEVICE_DISCONNECTED"]);
  });

  it("ignores port errors after close", async () => {
    const { fake, transport } = makeTransport();
    await transport.open();
    await transport.close();
    const codes: string[] = [];
    transport.onError((error) => codes.push(error.code));
    fake.simulateError(new Error("late"));
    expect(codes).toHaveLength(0);
  });
});

describe("NodeSerialTransport close / unplug", () => {
  it("emits onClose exactly once on close", async () => {
    const { fake, transport } = makeTransport();
    await transport.open();
    let closeCount = 0;
    transport.onClose(() => closeCount++);
    const result = await transport.close();
    expect(result.ok).toBe(true);
    expect(closeCount).toBe(1);
    expect(transport.isOpen()).toBe(false);
    expect(fake.closed).toBe(true);
  });

  it("is idempotent across repeated close calls", async () => {
    const { transport } = makeTransport();
    await transport.open();
    let closeCount = 0;
    transport.onClose(() => closeCount++);
    await transport.close();
    await transport.close();
    expect(closeCount).toBe(1);
  });

  it("reports unplug via onClose when the port closes unexpectedly", async () => {
    const { fake, transport } = makeTransport();
    await transport.open();
    let closeCount = 0;
    transport.onClose(() => closeCount++);
    fake.simulateClose();
    expect(closeCount).toBe(1);
    expect(transport.isOpen()).toBe(false);
  });

  it("does not deliver late data after close", async () => {
    const { fake, transport } = makeTransport();
    await transport.open();
    const received: Uint8Array[] = [];
    transport.onData((chunk) => received.push(chunk));
    await transport.close();
    fake.simulateData(Uint8Array.from([0xde, 0xad]));
    expect(received).toHaveLength(0);
  });

  it("can reopen after close", async () => {
    const { fake, transport } = makeTransport();
    await transport.open();
    await transport.close();
    const result = await transport.open();
    expect(result.ok).toBe(true);
    expect(transport.isOpen()).toBe(true);
    expect(fake.isOpen).toBe(true);
  });
});

describe("NodeSerialTransport listener hygiene (§34.3.13)", () => {
  it("does not accumulate delivery over 100 connect/disconnect cycles", async () => {
    const { fake, transport } = makeTransport();
    const received: Uint8Array[] = [];
    transport.onData((chunk) => received.push(chunk));
    for (let i = 0; i < 100; i++) {
      const opened = await transport.open();
      expect(opened.ok).toBe(true);
      fake.simulateData(Uint8Array.from([0xaa]));
      await transport.close();
    }
    // 每轮恰好一次投递，无重复注册。
    expect(received).toHaveLength(100);
  });

  it("does not emit close repeatedly across cycles (each cycle notifies once)", async () => {
    const { transport } = makeTransport();
    let closeCount = 0;
    transport.onClose(() => closeCount++);
    for (let i = 0; i < 20; i++) {
      await transport.open();
      await transport.close();
    }
    expect(closeCount).toBe(20);
  });
});
