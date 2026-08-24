import { describe, expect, it } from "vitest";
import { browserCapabilities, type PlatformCapabilities } from "./capabilities";

describe("browserCapabilities", () => {
  const caps: PlatformCapabilities = browserCapabilities;

  it("supports Modbus RTU but not Modbus TCP", () => {
    expect(caps.modbusRtu).toBe(true);
    expect(caps.modbusTcp).toBe(false);
  });

  it("uses browser picker authorization for serial ports", () => {
    expect(caps.serialPorts).toBe("browser-picker");
  });

  it("has limited filesystem and no Node.js plugins", () => {
    expect(caps.filesystem).toBe("limited");
    expect(caps.nodePlugins).toBe(false);
  });

  it("supports UI-safe web plugins", () => {
    expect(caps.webPlugins).toBe(true);
  });

  it("loads external connection config via import/URL (no filesystem)", () => {
    expect(caps.connectionConfig).toBe("import");
  });
});
