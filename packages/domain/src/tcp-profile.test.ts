import { describe, expect, it } from "vitest";
import { createTcpConnectionProfile } from "./tcp-profile";

describe("createTcpConnectionProfile", () => {
  it("accepts a valid profile and fills defaults", () => {
    const result = createTcpConnectionProfile({
      host: "127.0.0.1",
      port: 502,
      unitId: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        protocol: "tcp",
        host: "127.0.0.1",
        port: 502,
        unitId: 1,
        connectTimeoutMs: 5000,
        requestTimeoutMs: 50,
        retryCount: 1,
        autoReconnect: false,
        interRequestDelayMs: 50,
      });
      expect(result.value.id).toBe("");
      expect(result.value.name).toBe("TCP");
    }
  });

  it("keeps provided extended fields and id/name", () => {
    const result = createTcpConnectionProfile({
      id: "conn-1",
      name: "PLC",
      host: "192.168.1.10",
      port: 502,
      unitId: 0,
      connectTimeoutMs: 3000,
      requestTimeoutMs: 2000,
      retryCount: 3,
      autoReconnect: true,
      interRequestDelayMs: 100,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        id: "conn-1",
        name: "PLC",
        protocol: "tcp",
        host: "192.168.1.10",
        port: 502,
        unitId: 0,
        connectTimeoutMs: 3000,
        requestTimeoutMs: 2000,
        retryCount: 3,
        autoReconnect: true,
        interRequestDelayMs: 100,
      });
    }
  });

  it("rejects non-object input", () => {
    const result = createTcpConnectionProfile(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TCP_HOST_INVALID");
      expect(result.error.category).toBe("validation");
    }
  });

  it("rejects empty or non-string host", () => {
    expect(createTcpConnectionProfile({ host: "", port: 502, unitId: 1 }).ok).toBe(false);
    expect(
      createTcpConnectionProfile({ host: "  ", port: 502, unitId: 1 }).ok,
    ).toBe(false);
    expect(createTcpConnectionProfile({ host: 42, port: 502, unitId: 1 }).ok).toBe(false);
  });

  it("rejects ports outside 1..65535", () => {
    expect(createTcpConnectionProfile({ host: "h", port: 0, unitId: 1 }).ok).toBe(false);
    expect(createTcpConnectionProfile({ host: "h", port: 65536, unitId: 1 }).ok).toBe(false);
    expect(createTcpConnectionProfile({ host: "h", port: 1.5, unitId: 1 }).ok).toBe(false);
    const result = createTcpConnectionProfile({ host: "h", port: 0, unitId: 1 });
    if (!result.ok) expect(result.error.code).toBe("TCP_PORT_OUT_OF_RANGE");
  });

  it("accepts port boundaries 1 and 65535", () => {
    expect(createTcpConnectionProfile({ host: "h", port: 1, unitId: 1 }).ok).toBe(true);
    expect(createTcpConnectionProfile({ host: "h", port: 65535, unitId: 1 }).ok).toBe(true);
  });

  it("rejects unitId outside 0..255", () => {
    expect(createTcpConnectionProfile({ host: "h", port: 502, unitId: -1 }).ok).toBe(false);
    expect(createTcpConnectionProfile({ host: "h", port: 502, unitId: 256 }).ok).toBe(false);
    expect(createTcpConnectionProfile({ host: "h", port: 502, unitId: 1.5 }).ok).toBe(false);
    const result = createTcpConnectionProfile({ host: "h", port: 502, unitId: 256 });
    if (!result.ok) expect(result.error.code).toBe("TCP_UNIT_ID_OUT_OF_RANGE");
  });

  it("accepts unitId full MBAP range 0 and 255", () => {
    expect(createTcpConnectionProfile({ host: "h", port: 502, unitId: 0 }).ok).toBe(true);
    expect(createTcpConnectionProfile({ host: "h", port: 502, unitId: 255 }).ok).toBe(true);
  });
});
