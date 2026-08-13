import { describe, expect, it } from "vitest";
import { defaultConfig } from "./config";

describe("defaultConfig (docs/AGENTS.md §42 集中默认值)", () => {
  it("uses 9600 baud, 8 data bits, 1 stop bit, no parity, flow control off", () => {
    expect(defaultConfig.rtu.baudRate).toBe(9600);
    expect(defaultConfig.rtu.dataBits).toBe(8);
    expect(defaultConfig.rtu.stopBits).toBe(1);
    expect(defaultConfig.rtu.parity).toBe("none");
    expect(defaultConfig.rtu.flowControl).toBe("off");
  });

  it("uses slave address default 1 within range 0..255", () => {
    expect(defaultConfig.rtu.slaveAddress).toBe(1);
  });

  it("uses Rx Delay default 50 ms which also drives WP polling interval", () => {
    expect(defaultConfig.rtu.interRequestDelayMs).toBe(50);
  });

  it("uses Address Adjust default OFF", () => {
    expect(defaultConfig.rtu.addressAdjust).toBe("off");
  });

  it("uses request timeout 1000 ms and retry count 1", () => {
    expect(defaultConfig.rtu.requestTimeoutMs).toBe(1000);
    expect(defaultConfig.rtu.retryCount).toBe(1);
  });

  it("caps communication log at 10000 and application messages at 2000", () => {
    expect(defaultConfig.logging.maxCommunicationLogEntries).toBe(10000);
    expect(defaultConfig.logging.maxApplicationMessages).toBe(2000);
  });

  it("debounces autosave at 500 ms", () => {
    expect(defaultConfig.autosave.debounceMs).toBe(500);
  });

  it("caps Trace Continue buffer at 10000 entries", () => {
    expect(defaultConfig.trace.maxContinueEntries).toBe(10000);
  });

  it("defines trace speed range 100..2000 ms", () => {
    expect(defaultConfig.trace.speedMinMs).toBe(100);
    expect(defaultConfig.trace.speedMaxMs).toBe(2000);
  });

  it("limits polling to one pending task per row", () => {
    expect(defaultConfig.polling.maxPendingPollingTasks).toBe(1);
  });
});
