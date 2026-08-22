import { describe, expect, it } from "vitest";
import { describeNodeSerialCapabilities } from "./serial-capabilities";

describe("describeNodeSerialCapabilities", () => {
  it("reports the serialport-compatible capability surface", () => {
    const caps = describeNodeSerialCapabilities({
      platform: "win32",
      libraryVersion: "13.0.0",
    });
    expect(caps.enumeration).toBe(true);
    expect(caps.dataBits).toEqual([7, 8]);
    expect(caps.stopBits).toEqual([1, 2]);
    expect(caps.parity).toEqual(["none", "even", "odd"]);
    expect(caps.flowControl).toEqual(["off", "rts-cts", "xon-xoff"]);
    expect(caps.unplugDetection).toBe(true);
    expect(caps.usbMetadata).toBe(true);
    expect(caps.customBaudRates).toBe(true);
    expect(caps.platform).toBe("win32");
    expect(caps.host).toBe("node");
    expect(caps.library).toBe("serialport");
    expect(caps.libraryVersion).toBe("13.0.0");
  });

  it("defaults platform/library/version to placeholders for pure tests", () => {
    const caps = describeNodeSerialCapabilities();
    expect(caps.platform).toBe("unknown");
    expect(caps.library).toBe("serialport");
    expect(caps.libraryVersion).toBe("unknown");
  });
});
