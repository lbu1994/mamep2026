import { describe, expect, it } from "vitest";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import {
  SUPPORTED_BAUD_RATES,
  toSerialPortOpenLike,
  validateSerialParameters,
} from "./serial-config";

describe("toSerialPortOpenLike", () => {
  it("maps profile parameters to library open options", () => {
    const options = toSerialPortOpenLike("COM4", createDefaultRtuProfile());
    expect(options).toEqual({
      path: "COM4",
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      rtscts: false,
      xon: false,
      xoff: false,
      lock: true,
    });
  });

  it("maps rts-cts flow control to rtscts flag", () => {
    const profile = createDefaultRtuProfile();
    const options = toSerialPortOpenLike("COM4", {
      ...profile,
      flowControl: "rts-cts",
    });
    expect(options.rtscts).toBe(true);
    expect(options.xon).toBe(false);
    expect(options.xoff).toBe(false);
  });

  it("maps xon-xoff flow control to xon/xoff flags", () => {
    const profile = createDefaultRtuProfile();
    const options = toSerialPortOpenLike("/dev/ttyUSB0", {
      ...profile,
      flowControl: "xon-xoff",
    });
    expect(options.xon).toBe(true);
    expect(options.xoff).toBe(true);
    expect(options.rtscts).toBe(false);
  });

  it("maps off flow control to all-false flags", () => {
    const profile = createDefaultRtuProfile();
    const options = toSerialPortOpenLike("COM4", {
      ...profile,
      flowControl: "off",
    });
    expect(options.rtscts).toBe(false);
    expect(options.xon).toBe(false);
    expect(options.xoff).toBe(false);
  });

  it("passes high-number COM path through opaque unchanged (COM10+)", () => {
    const profile = createDefaultRtuProfile();
    expect(toSerialPortOpenLike("COM10", profile).path).toBe("COM10");
    expect(toSerialPortOpenLike("COM99", profile).path).toBe("COM99");
  });

  it("passes POSIX paths through opaque unchanged", () => {
    const profile = createDefaultRtuProfile();
    expect(toSerialPortOpenLike("/dev/ttyACM0", profile).path).toBe(
      "/dev/ttyACM0",
    );
  });
});

describe("validateSerialParameters", () => {
  it("accepts a valid default profile", () => {
    expect(validateSerialParameters(createDefaultRtuProfile())).toEqual({
      ok: true,
    });
  });

  it("rejects zero baudRate before opening", () => {
    const profile = createDefaultRtuProfile();
    const result = validateSerialParameters({ ...profile, baudRate: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("baudRate");
  });

  it("rejects negative baudRate", () => {
    const profile = createDefaultRtuProfile();
    expect(validateSerialParameters({ ...profile, baudRate: -9600 }).ok).toBe(
      false,
    );
  });

  it("rejects non-integer baudRate", () => {
    const profile = createDefaultRtuProfile();
    expect(validateSerialParameters({ ...profile, baudRate: 9600.5 }).ok).toBe(
      false,
    );
  });

  it("rejects NaN baudRate", () => {
    const profile = createDefaultRtuProfile();
    expect(
      validateSerialParameters({ ...profile, baudRate: Number.NaN }).ok,
    ).toBe(false);
  });

  it("exposes the §34.3.5 standard baud rate list", () => {
    expect(SUPPORTED_BAUD_RATES).toEqual([
      1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200,
    ]);
  });
});
