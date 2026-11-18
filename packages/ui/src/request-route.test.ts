import { describe, expect, it, vi } from "vitest";
import type { CommProperties } from "./host";
import { requestProtocolResolver, requestRouteForSheet } from "./request-route";
import { makeHost } from "./test/make-app-host";

const TCP_PROPERTIES: CommProperties = {
  protocol: "tcp",
  portLabel: "127.0.0.1:1502",
  unitId: 1,
  baudRate: 0,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  flowControl: "off",
  timeoutMs: 1000,
  retryCount: 1,
  connectionState: "connected",
};

describe("requestRouteForSheet", () => {
  it("captures the owning sheet address and resolved codec protocol", () => {
    const { host } = makeHost({
      protocolExtensions: ["modbus-basic-tables:coil"],
    });
    expect(
      requestRouteForSheet(host, {
        type: "coil",
        slaveAddress: 7,
      }),
    ).toEqual({
      unitAddress: 7,
      protocol: "modbus-basic-tables:coil",
    });
  });

  it("uses RTU for the core holding-register table", () => {
    const { host } = makeHost();
    expect(
      requestRouteForSheet(host, {
        type: "holding-register",
        slaveAddress: 3,
      }),
    ).toEqual({ unitAddress: 3, protocol: "rtu" });
  });

  it("uses the active TCP protocol for the core holding-register table", () => {
    const { host } = makeHost();
    vi.mocked(host.getCommProperties).mockReturnValue(TCP_PROPERTIES);

    expect(
      requestRouteForSheet(host, {
        type: "holding-register",
        slaveAddress: 9,
      }),
    ).toEqual({ unitAddress: 9, protocol: "tcp" });
    expect(requestProtocolResolver(host)("holding-register")).toBe("tcp");
  });

  it("keeps codec protocol IDs independent from the transport protocol", () => {
    const { host } = makeHost({
      protocolExtensions: ["modbus-basic-tables:coil"],
    });
    vi.mocked(host.getCommProperties).mockReturnValue(TCP_PROPERTIES);

    expect(
      requestRouteForSheet(host, {
        type: "coil",
        slaveAddress: 4,
      }),
    ).toEqual({
      unitAddress: 4,
      protocol: "modbus-basic-tables:coil",
    });
  });
});
