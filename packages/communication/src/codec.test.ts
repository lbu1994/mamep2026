import { describe, expect, it } from "vitest";
import { createCodecRegistry, type ProtocolCodec } from "./codec";

/** 最小 codec 桩：仅验证注册表语义。 */
const fakeCodec: ProtocolCodec = {
  protocolId: "fake",
  encodeRead: () => new Uint8Array([0x01]),
  encodeWrite: () => new Uint8Array([0x01]),
  decodeResponse: () => ({ ok: true, value: { kind: "write" } }),
  parserFactory: () => ({
    push: () => ({ done: false }),
  }),
  expectedLength: () => ({ normal: 8, exception: 5 }),
};

describe("createCodecRegistry", () => {
  it("registers and resolves a codec by protocolId", () => {
    const registry = createCodecRegistry();
    registry.register(fakeCodec);
    expect(registry.get("fake")).toBe(fakeCodec);
    expect(registry.get("missing")).toBeUndefined();
  });

  it("lists registered ids in registration order", () => {
    const registry = createCodecRegistry();
    registry.register(fakeCodec);
    expect(registry.list()).toEqual(["fake"]);
  });

  it("overwrites an existing id on re-register", () => {
    const registry = createCodecRegistry();
    registry.register(fakeCodec);
    const second: ProtocolCodec = { ...fakeCodec, protocolId: "fake" };
    registry.register(second);
    expect(registry.get("fake")).toBe(second);
    expect(registry.list()).toEqual(["fake"]);
  });
});
