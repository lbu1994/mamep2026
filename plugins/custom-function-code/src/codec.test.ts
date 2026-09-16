import { describe, expect, it } from "vitest";
import { appendCrc, crc16Modbus } from "@mamep2026/protocol-modbus";
import { CustomFunctionCodec } from "./codec";

function withCrc(payload: number[]): Uint8Array {
  const body = Uint8Array.from(payload);
  void crc16Modbus(body);
  return appendCrc(body);
}

describe("CustomFunctionCodec (ADR-043 E-4)", () => {
  const codec = new CustomFunctionCodec();

  it("暴露示例协议 ID 与数量上限", () => {
    expect(codec.protocolId).toBe("custom-function-code");
    expect(codec.maxRead).toBe(64);
    expect(codec.maxWrite).toBe(64);
  });

  it("编码 0x65 读请求", () => {
    const frame = codec.encodeRead({ slaveAddress: 1, addresses: [0, 1] });
    expect(Array.from(frame.slice(0, 6))).toEqual([
      0x01, 0x65, 0x00, 0x00, 0x00, 0x02,
    ]);
  });

  it("编码 0x66 写请求（大端值）", () => {
    const frame = codec.encodeWrite({
      slaveAddress: 1,
      entries: [
        { address: 0, value: 0x1234 },
        { address: 1, value: 0xabcd },
      ],
    });
    expect(Array.from(frame.slice(0, 7))).toEqual([
      0x01, 0x66, 0x00, 0x00, 0x00, 0x02, 0x04,
    ]);
    expect(frame[7]).toBe(0x12);
    expect(frame[8]).toBe(0x34);
    expect(frame[9]).toBe(0xab);
    expect(frame[10]).toBe(0xcd);
  });

  it("解码 0x65 读响应", () => {
    const frame = withCrc([0x01, 0x65, 0x04, 0x12, 0x34, 0xab, 0xcd]);
    const result = codec.decodeResponse(frame, {
      protocolId: "custom-function-code",
      kind: "read",
      request: { slaveAddress: 1, addresses: [0, 1] },
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value).toEqual({ kind: "read", values: [0x1234, 0xabcd] });
  });

  it("解码 0x66 写回执（echo address+quantity）", () => {
    const frame = withCrc([0x01, 0x66, 0x00, 0x01, 0x00, 0x02]);
    const result = codec.decodeResponse(frame, {
      protocolId: "custom-function-code",
      kind: "write",
      request: {
        slaveAddress: 1,
        entries: [
          { address: 1, value: 1 },
          { address: 2, value: 2 },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ kind: "write" });
  });

  it("解码异常响应（0x65|0x80）", () => {
    const frame = withCrc([0x01, 0xe5, 0x02]);
    const result = codec.decodeResponse(frame, {
      protocolId: "custom-function-code",
      kind: "read",
      request: { slaveAddress: 1, addresses: [0] },
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value).toEqual({ kind: "exception", exceptionCode: 0x02 });
  });

  it("函数不匹配返回失败", () => {
    const frame = withCrc([0x01, 0x03, 0x02, 0x12, 0x34]);
    const result = codec.decodeResponse(frame, {
      protocolId: "custom-function-code",
      kind: "read",
      request: { slaveAddress: 1, addresses: [0] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CUSTOM_FUNCTION_MISMATCH");
  });

  it("期望长度：读 3+2N+2、写 8、异常 5", () => {
    expect(
      codec.expectedLength("read", {
        protocolId: "custom-function-code",
        kind: "read",
        request: { slaveAddress: 1, addresses: [0, 1] },
      }),
    ).toEqual({ normal: 9, exception: 5 });
    expect(
      codec.expectedLength("write", {
        protocolId: "custom-function-code",
        kind: "write",
        request: { slaveAddress: 1, entries: [{ address: 0, value: 1 }] },
      }),
    ).toEqual({ normal: 8, exception: 5 });
  });

  it("数量越界抛错", () => {
    expect(() =>
      codec.encodeRead({ slaveAddress: 1, addresses: [] }),
    ).toThrow();
  });
});
