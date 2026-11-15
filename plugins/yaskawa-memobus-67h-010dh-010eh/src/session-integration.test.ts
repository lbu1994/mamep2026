/**
 * 集成测试（决策 B）：软件（CommunicationSession 的 ProtocolCodec 接口 +
 * CodecRegistry + 会话注入）只提供调用接口；安川专用功能码 67/010D、67/010E 全部在插件内实现。
 * 用真实 MemobusCodec 经 CodecRegistry 注入会话，验证读/写/异常三闭环。
 */
import { describe, expect, it } from "vitest";
import {
  CommunicationSession,
  createCodecRegistry,
} from "@mamep2026/communication";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import { FakeTransport, VirtualClock } from "@mamep2026/test-kit";
import { MemobusCodec } from "./memobus-codec";

function hex(hexString: string): Uint8Array {
  return Uint8Array.from(hexString.split(" ").map((x) => parseInt(x, 16)));
}

/** 步进推进虚拟时钟并 flush microtask，让异步链路能注册下一次定时器。 */
async function advanceUntil(
  clock: VirtualClock,
  predicate: () => boolean,
  step = 5,
  maxSteps = 400,
): Promise<void> {
  for (let i = 0; i < maxSteps && !predicate(); i++) {
    clock.advance(step);
    await Promise.resolve();
    await Promise.resolve();
  }
}

function makeSession() {
  const clock = new VirtualClock();
  const transport = new FakeTransport();
  const registry = createCodecRegistry();
  registry.register(new MemobusCodec());
  const session = new CommunicationSession({
    transport,
    clock,
    config: createDefaultRtuProfile(),
    protocol: "yaskawa-memobus-67h-010dh-010eh",
    codecRegistry: registry,
  });
  return { clock, transport, session };
}

describe("MemobusCodec × CommunicationSession 集成（决策 B）", () => {
  it("67/010D 非连续读闭环：发出手册请求帧并解码响应", async () => {
    const { session, transport, clock } = makeSession();
    await session.connect();

    const promise = session.readRegistersAt([0x0024, 0x0028], {
      source: "manual-read",
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    expect(Array.from(transport.sentFrames[0] ?? [])).toEqual(
      Array.from(hex("01 67 01 0D 00 02 00 24 00 28 8B 29")),
    );

    transport.simulateData(hex("01 67 01 0D 00 04 17 70 03 E8 47 ED"));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([0x1770, 0x03e8]);
  });

  it("67/010E 非连续写闭环：发出手册请求帧并确认写响应", async () => {
    const { session, transport, clock } = makeSession();
    await session.connect();

    const promise = session.writeRegistersAt(
      [
        { address: 0x0002, value: 0x1770 },
        { address: 0x0004, value: 0x05dc },
      ],
      { source: "manual-write" },
    );
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    expect(Array.from(transport.sentFrames[0] ?? [])).toEqual(
      Array.from(hex("01 67 01 0E 00 02 00 04 00 02 17 70 00 04 05 DC 55 59")),
    );

    transport.simulateData(hex("01 67 01 0E 00 02 D5 FC"));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.kind).toBe("write-succeeded-no-verify");
  });

  it("异常响应（0xE7 + 错误码）经插件 mapException 映射为 MEMOBUS_EXCEPTION", async () => {
    const { session, transport, clock } = makeSession();
    await session.connect();

    const promise = session.readRegistersAt([0x0900], {
      source: "manual-read",
    });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(hex("01 E7 02 EA 31"));
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MEMOBUS_EXCEPTION_02");
      expect(result.error.category).toBe("modbus-exception");
    }
  });
});
