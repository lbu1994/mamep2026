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
  it("revokes only the owning generation and never revives a captured lease", () => {
    const registry = createCodecRegistry();
    const first = registry.createScope("vendor");
    expect(first.register(fakeCodec).ok).toBe(true);
    const lease = registry.capture("fake");
    expect(lease?.isCurrent()).toBe(true);
    first.dispose();
    expect(registry.get("fake")).toBeUndefined();
    expect(lease?.isCurrent()).toBe(false);
    const replacement = registry.createScope("vendor");
    expect(replacement.register(fakeCodec).ok).toBe(true);
    first.dispose();
    expect(first.register(fakeCodec)).toMatchObject({
      ok: false,
      error: { code: "CODEC_SCOPE_REVOKED" },
    });
    expect(first.list()).toEqual([]);
    expect(registry.get("fake")).toBe(fakeCodec);
    expect(lease?.isCurrent()).toBe(false);
  });

  it("protects core and other plugin registrations from conflicts and cleanup", () => {
    const registry = createCodecRegistry();
    registry.register(fakeCodec);
    const scope = registry.createScope("vendor");
    for (const protocolId of ["fake", "rtu", "tcp"]) {
      expect(scope.register({ ...fakeCodec, protocolId })).toMatchObject({
        ok: false,
        error: { code: "CODEC_ID_CONFLICT" },
      });
    }
    expect(scope.register({ ...fakeCodec, protocolId: "vendor" }).ok).toBe(
      true,
    );
    const other = registry.createScope("other");
    expect(other.register({ ...fakeCodec, protocolId: "vendor" }).ok).toBe(
      false,
    );
    other.dispose();
    expect(registry.list()).toEqual(["fake", "vendor"]);
    scope.dispose();
    expect(registry.list()).toEqual(["fake"]);
  });

  it("invalidates a lease when the same codec object is registered again", () => {
    const registry = createCodecRegistry();
    const scope = registry.createScope("vendor");
    scope.register(fakeCodec);
    const lease = registry.capture("fake");
    scope.register(fakeCodec);
    expect(lease?.isCurrent()).toBe(false);
    expect(registry.capture("fake")?.isCurrent()).toBe(true);
  });

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
