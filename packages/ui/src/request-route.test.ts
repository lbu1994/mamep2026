import { describe, expect, it } from "vitest";
import { requestRouteForSheet } from "./request-route";
import { makeHost } from "./test/make-app-host";

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
});
