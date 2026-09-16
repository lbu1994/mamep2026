import { describe, expect, it } from "vitest";
import {
  MAMEP_TRANSPORT_EVENTS,
  MAMEP_TRANSPORT_METHODS,
  bridgeOpenTcpParamsSchema,
  bridgeWriteParamsSchema,
  buildBridgeParams,
  decodeBase64ToBytes,
  encodeBytesToBase64,
  parseBridgePayload,
} from "./bridge-contract";

describe("bridge-contract：方法/事件白名单", () => {
  it("登记 Phase 1 的全部桥方法与事件（新增接口必须显式入册）", () => {
    expect([...MAMEP_TRANSPORT_METHODS]).toEqual([
      "listSerialPorts",
      "openSerial",
      "openTcp",
      "write",
      "close",
      "setKeepScreenOn",
    ]);
    expect([...MAMEP_TRANSPORT_EVENTS]).toEqual(["data", "closed", "error"]);
  });
});

describe("bridge-contract：base64 编解码", () => {
  it("空字节与 1/2/3 字节（含填充）往返一致", () => {
    for (const bytes of [
      new Uint8Array([]),
      new Uint8Array([0x01]),
      new Uint8Array([0x01, 0x03]),
      new Uint8Array([0x01, 0x03, 0x00]),
      new Uint8Array([0x01, 0x03, 0x00, 0x00]),
    ]) {
      const encoded = encodeBytesToBase64(bytes);
      const decoded = decodeBase64ToBytes(encoded);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect([...decoded.value]).toEqual([...bytes]);
    }
  });

  it("Modbus RTU 请求帧编码为已知 base64（与 spike 实测值一致）", () => {
    expect(
      encodeBytesToBase64(new Uint8Array([1, 3, 0, 0, 0, 1, 132, 10])),
    ).toBe("AQMAAAABhAo=");
  });

  it("覆盖 0x00~0xFF 全字节范围（含高位非 ASCII 字节）", () => {
    const bytes = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) bytes[index] = index;
    const decoded = decodeBase64ToBytes(encodeBytesToBase64(bytes));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect([...decoded.value]).toEqual([...bytes]);
  });

  it("非法字符 / 非法长度一律失败（不静默丢弃）", () => {
    const illegalChar = decodeBase64ToBytes("AQM*");
    expect(illegalChar.ok).toBe(false);
    if (!illegalChar.ok)
      expect(illegalChar.error.code).toBe("BRIDGE_PAYLOAD_INVALID");

    const illegalLength = decodeBase64ToBytes("AQM");
    expect(illegalLength.ok).toBe(false);
    if (!illegalLength.ok) {
      expect(illegalLength.error.code).toBe("BRIDGE_PAYLOAD_INVALID");
      expect(illegalLength.error.category).toBe("internal");
      expect(illegalLength.error.userMessageKey).toBe(
        "errors.bridgePayloadInvalid",
      );
    }
  });
});

describe("bridge-contract：出参与回包校验", () => {
  it("openTcp 参数非法（端口越界 / host 空 / 缺超时）被拒", () => {
    expect(
      buildBridgeParams(
        bridgeOpenTcpParamsSchema,
        { host: "", port: 1, connectTimeoutMs: 1 },
        "openTcp",
      ).ok,
    ).toBe(false);
    expect(
      buildBridgeParams(
        bridgeOpenTcpParamsSchema,
        { host: "h", port: 0, connectTimeoutMs: 1 },
        "openTcp",
      ).ok,
    ).toBe(false);
    expect(
      buildBridgeParams(
        bridgeOpenTcpParamsSchema,
        { host: "h", port: 70000, connectTimeoutMs: 1 },
        "openTcp",
      ).ok,
    ).toBe(false);
    expect(
      buildBridgeParams(
        bridgeOpenTcpParamsSchema,
        { host: "h", port: 502 },
        "openTcp",
      ).ok,
    ).toBe(false);
  });

  it("openTcp 参数合法时原样返回", () => {
    const built = buildBridgeParams(
      bridgeOpenTcpParamsSchema,
      { host: "192.168.1.10", port: 502, connectTimeoutMs: 5000 },
      "openTcp",
    );
    expect(built.ok).toBe(true);
    if (built.ok)
      expect(built.value).toEqual({
        host: "192.168.1.10",
        port: 502,
        connectTimeoutMs: 5000,
      });
  });

  it("write 参数要求非空 base64", () => {
    expect(
      buildBridgeParams(bridgeWriteParamsSchema, { data: "" }, "write").ok,
    ).toBe(false);
    expect(
      buildBridgeParams(bridgeWriteParamsSchema, { data: "AQ==" }, "write").ok,
    ).toBe(true);
    expect(buildBridgeParams(bridgeWriteParamsSchema, {}, "write").ok).toBe(
      false,
    );
  });

  it("回包形状非法时失败并带上下文（不静默降级）", () => {
    const parsed = parseBridgePayload(
      bridgeOpenTcpParamsSchema,
      { unexpected: true },
      "transport.data",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("BRIDGE_PAYLOAD_INVALID");
      expect(parsed.error.technicalMessage).toContain("transport.data");
    }
  });
});
