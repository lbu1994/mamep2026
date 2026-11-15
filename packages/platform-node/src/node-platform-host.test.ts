import { describe, expect, it } from "vitest";
import {
  createDefaultRtuProfile,
  type TcpConnectionProfile,
} from "@mamep2026/domain";
import { NodePlatformHost, displayLabel } from "./node-platform-host";
import { FakeSerialPortFactory } from "./testing/fake-serial-port";
import { FakeNetFactory } from "./testing/fake-socket";

/** 完整 TCP 连接配置（openTcpTransport 入参 TCP 接线）。 */
function tcpProfile(
  host: string,
  port: number,
  unitId: number,
): TcpConnectionProfile {
  return {
    id: "conn-tcp" as TcpConnectionProfile["id"],
    name: "TCP",
    protocol: "tcp",
    host,
    port,
    unitId,
    connectTimeoutMs: 5000,
    requestTimeoutMs: 1000,
    retryCount: 1,
    autoReconnect: false,
  };
}

const ports = [
  { path: "COM4", manufacturer: "com0com" },
  { path: "COM10", manufacturer: "USB Serial" },
];

describe("NodePlatformHost enumerateSerialPorts", () => {
  it("maps enumerated ports to handles with raw path id and display label", async () => {
    const host = new NodePlatformHost({
      factory: new FakeSerialPortFactory(ports),
    });
    const result = await host.enumerateSerialPorts();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { id: "COM4", label: "com0com (COM4)" },
        { id: "COM10", label: "USB Serial (COM10)" },
      ]);
    }
  });

  it("returns an empty list when no ports are available", async () => {
    const host = new NodePlatformHost({
      factory: new FakeSerialPortFactory([]),
    });
    const result = await host.enumerateSerialPorts();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it("returns a structured error on enumeration failure", async () => {
    const factory = new FakeSerialPortFactory(ports);
    factory.listError = new Error("boom");
    const host = new NodePlatformHost({ factory });
    const result = await host.enumerateSerialPorts();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SERIAL_ERROR");
  });
});

describe("NodePlatformHost requestSerialPort", () => {
  it("returns the first port (prototype semantics)", async () => {
    const host = new NodePlatformHost({
      factory: new FakeSerialPortFactory(ports),
    });
    const result = await host.requestSerialPort();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value?.id).toBe("COM4");
  });

  it("returns null when no ports are available", async () => {
    const host = new NodePlatformHost({
      factory: new FakeSerialPortFactory([]),
    });
    const result = await host.requestSerialPort();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });
});

describe("NodePlatformHost openSerialTransport", () => {
  it("creates a node-serial transport with mapped open options", async () => {
    const factory = new FakeSerialPortFactory(ports);
    const host = new NodePlatformHost({ factory });
    const result = await host.openSerialTransport(
      { id: "COM10", label: "USB Serial (COM10)" },
      createDefaultRtuProfile(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("node-serial");
      expect(factory.created).toHaveLength(1);
      expect(factory.created[0]!.openedOptions.path).toBe("COM10");
      expect(factory.created[0]!.openedOptions.baudRate).toBe(9600);
      expect(factory.created[0]!.openedOptions.lock).toBe(true);
    }
  });

  it("rejects invalid parameters before creating a port", async () => {
    const factory = new FakeSerialPortFactory(ports);
    const host = new NodePlatformHost({ factory });
    const profile = createDefaultRtuProfile();
    const result = await host.openSerialTransport(
      { id: "COM4", label: "COM4" },
      { ...profile, baudRate: 0 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SERIAL_PARAMETER_UNSUPPORTED");
    }
    expect(factory.created).toHaveLength(0);
  });
});

describe("displayLabel", () => {
  it("includes manufacturer when present", () => {
    expect(displayLabel({ path: "COM4", manufacturer: "FTDI" })).toBe(
      "FTDI (COM4)",
    );
  });

  it("falls back to the raw path", () => {
    expect(displayLabel({ path: "/dev/ttyUSB0" })).toBe("/dev/ttyUSB0");
  });
});

describe("NodePlatformHost openTcpTransport", () => {
  it("creates a node-tcp transport with host/port passed through", async () => {
    const netFactory = new FakeNetFactory();
    const host = new NodePlatformHost({ netFactory });
    const result = await host.openTcpTransport(tcpProfile("127.0.0.1", 502, 1));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("node-tcp");
      expect(netFactory.created).toHaveLength(1);
      expect(netFactory.created[0]!.openedOptions).toEqual({
        host: "127.0.0.1",
        port: 502,
      });
    }
  });

  it("rejects invalid profile before creating a connection", async () => {
    const netFactory = new FakeNetFactory();
    const host = new NodePlatformHost({ netFactory });
    const result = await host.openTcpTransport(tcpProfile("", 502, 1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TCP_HOST_INVALID");
      expect(result.error.category).toBe("validation");
    }
    expect(netFactory.created).toHaveLength(0);
  });

  it("exposes default TCP capabilities (unit id 0..255)", () => {
    const host = new NodePlatformHost();
    expect(host.tcpCapabilities.host).toBe("node");
    expect(host.tcpCapabilities.unitIdMin).toBe(0);
    expect(host.tcpCapabilities.unitIdMax).toBe(255);
  });
});
