import { describe, expect, it } from "vitest";
import { crc16Modbus } from "./crc16";

describe("crc16Modbus", () => {
  it('computes the standard check value 0x4B37 for "123456789"', () => {
    const ascii = new TextEncoder().encode("123456789");
    expect(crc16Modbus(ascii)).toBe(0x4b37);
  });

  it("computes the known vector for read request 01 03 00 00 00 01 -> 84 0A", () => {
    const frame = Uint8Array.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]);
    // 帧尾字节为 84 0A（低字节在前），CRC 数值为 0x0A84
    expect(crc16Modbus(frame)).toBe(0x0a84);
  });

  it("computes an incremental CRC over a range of a buffer", () => {
    const frame = Uint8Array.from([
      0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
    ]);
    expect(crc16Modbus(frame, 0, 6)).toBe(0x0a84);
  });
});
