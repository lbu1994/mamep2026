import { describe, expect, it } from "vitest";
import { ScriptedModbusRtuDevice } from "./transport";

describe("ScriptedModbusRtuDevice basic tables (ADR-043 E-1)", () => {
  it("answers FC01 read coils with LSB-first bit packing", () => {
    const device = new ScriptedModbusRtuDevice();
    device.setCoil(0, 1);
    device.setCoil(1, 0);
    device.setCoil(2, 1);
    device.setCoil(3, 1);
    // 0b1101 = 0x0D
    const resp = device.handleFrame(
      Uint8Array.from([0x01, 0x01, 0x00, 0x00, 0x00, 0x04, 0, 0]),
    );
    expect(resp).not.toBeNull();
    expect(Array.from(resp!.slice(0, 4))).toEqual([0x01, 0x01, 0x01, 0x0d]);
  });

  it("answers FC02 read discrete inputs", () => {
    const device = new ScriptedModbusRtuDevice();
    device.setInput(5, 1);
    // 地址 5 对应位 5 → 0b100000 = 0x20
    const resp = device.handleFrame(
      Uint8Array.from([0x01, 0x02, 0x00, 0x00, 0x00, 0x08, 0, 0]),
    );
    expect(resp).not.toBeNull();
    expect(Array.from(resp!.slice(0, 4))).toEqual([0x01, 0x02, 0x01, 0x20]);
  });

  it("answers FC04 read input registers as 16-bit values", () => {
    const device = new ScriptedModbusRtuDevice();
    device.setInputRegister(0, 0x1234);
    device.setInputRegister(1, 0xabcd);
    const resp = device.handleFrame(
      Uint8Array.from([0x01, 0x04, 0x00, 0x00, 0x00, 0x02, 0, 0]),
    );
    expect(resp).not.toBeNull();
    expect(Array.from(resp!.slice(0, 6))).toEqual([
      0x01, 0x04, 0x04, 0x12, 0x34, 0xab,
    ]);
    expect(resp![6]).toBe(0xcd);
  });

  it("applies FC0F write multiple coils and echoes", () => {
    const device = new ScriptedModbusRtuDevice();
    // 值 [1,0,1,1,0,0,0,1] → 0x8D
    const resp = device.handleFrame(
      Uint8Array.from([0x01, 0x0f, 0x00, 0x00, 0x00, 0x08, 0x01, 0x8d, 0, 0]),
    );
    expect(resp).not.toBeNull();
    expect(Array.from(resp!.slice(0, 6))).toEqual([
      0x01, 0x0f, 0x00, 0x00, 0x00, 0x08,
    ]);
    expect(device.getCoil(0)).toBe(1);
    expect(device.getCoil(1)).toBe(0);
    expect(device.getCoil(2)).toBe(1);
    expect(device.getCoil(3)).toBe(1);
    expect(device.getCoil(7)).toBe(1);
    expect(device.getCoil(8)).toBeNull();
  });

  it("applies FC0F with quantity spanning two bytes", () => {
    const device = new ScriptedModbusRtuDevice();
    // 9 个值，第 9 位（索引 8）置位 → 第二字节 0x01
    const resp = device.handleFrame(
      Uint8Array.from([
        0x01, 0x0f, 0x00, 0x00, 0x00, 0x09, 0x02, 0x00, 0x01, 0, 0,
      ]),
    );
    expect(resp).not.toBeNull();
    expect(device.getCoil(8)).toBe(1);
    expect(device.getCoil(7)).toBe(0);
  });

  it("returns illegal function for unknown function codes", () => {
    const device = new ScriptedModbusRtuDevice();
    const resp = device.handleFrame(
      Uint8Array.from([0x01, 0x05, 0x00, 0x00, 0xff, 0x00, 0, 0]),
    );
    expect(resp).not.toBeNull();
    expect(Array.from(resp!.slice(0, 3))).toEqual([0x01, 0x85, 0x01]);
  });
});
