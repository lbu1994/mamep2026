import { describe, expect, it } from "vitest";
import {
  connectionToProfile,
  createDefaultConnectionConfig,
  parseConnectionConfig,
  resolveConnection,
  resolveDefaultConnection,
  type ConnectionConfigFile,
} from "./schema";

function parseOk(json: string): ConnectionConfigFile {
  const result = parseConnectionConfig(json);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected parse to succeed");
  return result.value;
}

describe("parseConnectionConfig", () => {
  it("parses a valid RTU connection object and backfills defaults", () => {
    const config = parseOk(
      JSON.stringify({
        schemaVersion: 1,
        connections: [
          {
            id: "rtu-com4",
            name: "COM4 slave",
            protocol: "rtu",
            port: "COM4",
            baudRate: 115200,
          },
        ],
      }),
    );
    expect(config.schemaVersion).toBe(1);
    expect(config.activeConnectionId).toBeNull();
    const rtu = config.connections[0];
    expect(rtu?.protocol).toBe("rtu");
    if (rtu === undefined || rtu.protocol !== "rtu") throw new Error("missing rtu");
    expect(rtu.port).toBe("COM4");
    expect(rtu.baudRate).toBe(115200);
    // 缺省字段回填默认值。
    expect(rtu.dataBits).toBe(8);
    expect(rtu.stopBits).toBe(1);
    expect(rtu.parity).toBe("none");
    expect(rtu.flowControl).toBe("off");
    expect(rtu.slaveAddress).toBe(1);
    expect(rtu.requestTimeoutMs).toBe(1000);
    expect(rtu.retryCount).toBe(1);
    expect(rtu.interRequestDelayMs).toBe(50);
    expect(rtu.addressAdjust).toBe("off");
  });

  it("parses a valid TCP connection object and backfills defaults", () => {
    const config = parseOk(
      JSON.stringify({
        schemaVersion: 1,
        activeConnectionId: "tcp-local",
        connections: [
          {
            id: "tcp-local",
            name: "local tcp slave",
            protocol: "tcp",
            host: "127.0.0.1",
            port: 1502,
            unitId: 1,
          },
        ],
      }),
    );
    expect(config.activeConnectionId).toBe("tcp-local");
    const tcp = config.connections[0];
    expect(tcp?.protocol).toBe("tcp");
    if (tcp === undefined || tcp.protocol !== "tcp") throw new Error("missing tcp");
    expect(tcp.host).toBe("127.0.0.1");
    expect(tcp.port).toBe(1502);
    expect(tcp.unitId).toBe(1);
    expect(tcp.connectTimeoutMs).toBe(5000);
    expect(tcp.requestTimeoutMs).toBe(1000);
    expect(tcp.retryCount).toBe(1);
    expect(tcp.autoReconnect).toBe(false);
    expect(tcp.interRequestDelayMs).toBe(50);
  });

  it("defaults connections to empty when omitted", () => {
    const config = parseOk(JSON.stringify({ schemaVersion: 1 }));
    expect(config.connections).toEqual([]);
    expect(config.activeConnectionId).toBeNull();
  });

  it("rejects invalid JSON", () => {
    const result = parseConnectionConfig("{ not json");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("CONNECTION_CONFIG_INVALID_JSON");
  });

  it("rejects an unsupported schemaVersion", () => {
    const result = parseConnectionConfig(
      JSON.stringify({ schemaVersion: 999, connections: [] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("CONNECTION_CONFIG_INVALID");
  });

  it("rejects invalid field values (port out of range / bad dataBits)", () => {
    const result = parseConnectionConfig(
      JSON.stringify({
        schemaVersion: 1,
        connections: [
          { id: "bad", name: "bad", protocol: "tcp", host: "h", port: 70000 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("CONNECTION_CONFIG_INVALID");

    const badBits = parseConnectionConfig(
      JSON.stringify({
        schemaVersion: 1,
        connections: [
          { id: "bad2", name: "bad2", protocol: "rtu", port: "COM1", dataBits: 9 },
        ],
      }),
    );
    expect(badBits.ok).toBe(false);
  });

  it("discriminates rtu vs tcp by protocol", () => {
    const config = parseOk(
      JSON.stringify({
        schemaVersion: 1,
        connections: [
          { id: "a", name: "a", protocol: "rtu", port: "COM1" },
          { id: "b", name: "b", protocol: "tcp", host: "h", port: 502 },
        ],
      }),
    );
    expect(config.connections).toHaveLength(2);
    expect(config.connections[0]?.protocol).toBe("rtu");
    expect(config.connections[1]?.protocol).toBe("tcp");
  });

  it("rejects a connection object with an unknown protocol", () => {
    const result = parseConnectionConfig(
      JSON.stringify({
        schemaVersion: 1,
        connections: [
          { id: "x", name: "x", protocol: "udp", port: 1 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("resolveConnection / resolveDefaultConnection", () => {
  const config = parseOk(
    JSON.stringify({
      schemaVersion: 1,
      activeConnectionId: "rtu-com4",
      connections: [
        { id: "rtu-com4", name: "rtu", protocol: "rtu", port: "COM4" },
        { id: "tcp-a", name: "tcp", protocol: "tcp", host: "h", port: 502 },
      ],
    }),
  );

  it("resolves by id", () => {
    expect(resolveConnection(config, "tcp-a")?.id).toBe("tcp-a");
    expect(resolveConnection(config, "missing")).toBeNull();
    expect(resolveConnection(config, null)).toBeNull();
  });

  it("resolves the default connection via activeConnectionId", () => {
    expect(resolveDefaultConnection(config)?.id).toBe("rtu-com4");
  });

  it("falls back to the first connection when activeConnectionId is unset", () => {
    const noActive = { ...config, activeConnectionId: null };
    expect(resolveDefaultConnection(noActive)?.id).toBe("rtu-com4");
  });
});

describe("connectionToProfile", () => {
  it("maps an RTU connection to an RtuConnectionProfile", () => {
    const config = parseOk(
      JSON.stringify({
        schemaVersion: 1,
        connections: [
          {
            id: "rtu-com4",
            name: "COM4 slave",
            protocol: "rtu",
            port: "COM4",
            baudRate: 9600,
            slaveAddress: 3,
          },
        ],
      }),
    );
    const connection = config.connections[0];
    if (connection === undefined || connection.protocol !== "rtu") {
      throw new Error("missing rtu connection");
    }
    const profile = connectionToProfile(connection);
    expect(profile.protocol).toBe("rtu");
    if (profile.protocol !== "rtu") throw new Error("expected rtu profile");
    expect(profile.id).toBe("rtu-com4");
    expect(profile.name).toBe("COM4 slave");
    expect(profile.baudRate).toBe(9600);
    expect(profile.dataBits).toBe(8);
    // 串口名进入 recentPortHint（仅提示，不用于自动连接）。
    expect(profile.recentPortHint).toBe("COM4");
    // slaveAddress 是连接对象的字段，不进入 profile（从站地址按表独立）。
    expect("slaveAddress" in profile).toBe(false);
  });

  it("maps a TCP connection to a TcpConnectionProfile", () => {
    const config = parseOk(
      JSON.stringify({
        schemaVersion: 1,
        connections: [
          {
            id: "tcp-local",
            name: "local",
            protocol: "tcp",
            host: "127.0.0.1",
            port: 1502,
            unitId: 7,
          },
        ],
      }),
    );
    const connection = config.connections[0];
    if (connection === undefined || connection.protocol !== "tcp") {
      throw new Error("missing tcp connection");
    }
    const profile = connectionToProfile(connection);
    expect(profile.protocol).toBe("tcp");
    if (profile.protocol !== "tcp") throw new Error("expected tcp profile");
    expect(profile.id).toBe("tcp-local");
    expect(profile.host).toBe("127.0.0.1");
    expect(profile.port).toBe(1502);
    expect(profile.unitId).toBe(7);
    expect(profile.connectTimeoutMs).toBe(5000);
    expect(profile.autoReconnect).toBe(false);
  });
});

describe("createDefaultConnectionConfig", () => {
  it("returns an empty valid config", () => {
    const config = createDefaultConnectionConfig();
    expect(config.schemaVersion).toBe(1);
    expect(config.connections).toEqual([]);
    expect(config.activeConnectionId).toBeNull();
    // 空配置也应能序列化后再解析。
    const reparsed = parseOk(JSON.stringify(config));
    expect(reparsed.connections).toEqual([]);
  });
});
