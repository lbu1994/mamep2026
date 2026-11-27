import { describe, expect, it } from "vitest";
import { appendCrc, crc16Modbus } from "@mamep2026/protocol-modbus";
import { createDefaultRtuProfile } from "@mamep2026/domain";
import { BasicTablesRtuCodec } from "./basic-tables-codec";
import { createCodecRegistry, type CodecExpect } from "./codec";
import { CommunicationSession } from "./session";
import { FakeTransport } from "./testing/fake-transport";
import { ManualClock, advanceUntil } from "./testing/manual-clock";

function withCrc(payload: number[]): Uint8Array {
  const body = Uint8Array.from(payload);
  void crc16Modbus(body);
  return appendCrc(body);
}

function readExpect(
  tableType: "coil" | "discrete-input" | "input-register",
  addresses: number[],
): CodecExpect {
  return {
    protocolId: `modbus-basic-tables:${tableType}`,
    kind: "read",
    request: { slaveAddress: 1, addresses },
  };
}

function writeExpect(
  entries: { address: number; value: number }[],
): CodecExpect {
  return {
    protocolId: "modbus-basic-tables:coil",
    kind: "write",
    request: { slaveAddress: 1, entries },
  };
}

describe("BasicTablesRtuCodec (ADR-043 E-2)", () => {
  it("暴露基础表协议 ID（每表类型独立 codec）", () => {
    expect(new BasicTablesRtuCodec("coil").protocolId).toBe(
      "modbus-basic-tables:coil",
    );
    expect(new BasicTablesRtuCodec("discrete-input").protocolId).toBe(
      "modbus-basic-tables:discrete-input",
    );
    expect(new BasicTablesRtuCodec("input-register").protocolId).toBe(
      "modbus-basic-tables:input-register",
    );
  });

  it("编码 FC01 读线圈（coil）", () => {
    const codec = new BasicTablesRtuCodec("coil");
    const frame = codec.encodeRead({
      slaveAddress: 1,
      addresses: [0, 1, 2, 3],
    });
    expect(Array.from(frame.slice(0, 6))).toEqual([
      0x01, 0x01, 0x00, 0x00, 0x00, 0x04,
    ]);
  });

  it("编码 FC02 读离散输入", () => {
    const codec = new BasicTablesRtuCodec("discrete-input");
    const frame = codec.encodeRead({ slaveAddress: 1, addresses: [0] });
    expect(Array.from(frame.slice(0, 6))).toEqual([
      0x01, 0x02, 0x00, 0x00, 0x00, 0x01,
    ]);
  });

  it("编码 FC04 读输入寄存器", () => {
    const codec = new BasicTablesRtuCodec("input-register");
    const frame = codec.encodeRead({ slaveAddress: 1, addresses: [0, 1] });
    expect(Array.from(frame.slice(0, 6))).toEqual([
      0x01, 0x04, 0x00, 0x00, 0x00, 0x02,
    ]);
  });

  it("编码 FC0F 写多线圈（coil，位打包）", () => {
    const codec = new BasicTablesRtuCodec("coil");
    const frame = codec.encodeWrite({
      slaveAddress: 1,
      entries: [
        { address: 0, value: 1 },
        { address: 1, value: 0 },
        { address: 2, value: 1 },
        { address: 3, value: 1 },
      ],
    });
    expect(Array.from(frame.slice(0, 7))).toEqual([
      0x01, 0x0f, 0x00, 0x00, 0x00, 0x04, 0x01,
    ]);
    expect(frame[7]).toBe(0x0d);
  });

  it("只读表 encodeWrite 抛错（discrete-input/input-register）", () => {
    const codec = new BasicTablesRtuCodec("input-register");
    let thrown = false;
    try {
      codec.encodeWrite({
        slaveAddress: 1,
        entries: [{ address: 0, value: 1 }],
      });
    } catch {
      thrown = true;
    }
    expect(thrown).toBe(true);
  });

  it("解码 FC01 位打包响应（coil）", () => {
    const codec = new BasicTablesRtuCodec("coil");
    const frame = withCrc([0x01, 0x01, 0x01, 0x8d]);
    const result = codec.decodeResponse(
      frame,
      readExpect("coil", [0, 1, 2, 3, 4, 5, 6, 7]),
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value).toEqual({
        kind: "read",
        values: [1, 0, 1, 1, 0, 0, 0, 1],
      });
  });

  it("解码 FC02 位打包响应（discrete-input）", () => {
    const codec = new BasicTablesRtuCodec("discrete-input");
    const frame = withCrc([0x01, 0x02, 0x01, 0x0a]);
    const result = codec.decodeResponse(
      frame,
      readExpect("discrete-input", [0, 1, 2, 3]),
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value).toEqual({ kind: "read", values: [0, 1, 0, 1] });
  });

  it("解码 FC04 16 位响应（input-register）", () => {
    const codec = new BasicTablesRtuCodec("input-register");
    const frame = withCrc([0x01, 0x04, 0x04, 0x12, 0x34, 0xab, 0xcd]);
    const result = codec.decodeResponse(
      frame,
      readExpect("input-register", [0, 1]),
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value).toEqual({ kind: "read", values: [0x1234, 0xabcd] });
  });

  it("解码 FC0F 写回执（coil）", () => {
    const codec = new BasicTablesRtuCodec("coil");
    const frame = withCrc([0x01, 0x0f, 0x00, 0x01, 0x00, 0x04]);
    const result = codec.decodeResponse(
      frame,
      writeExpect([
        { address: 1, value: 1 },
        { address: 2, value: 0 },
        { address: 3, value: 1 },
        { address: 4, value: 1 },
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ kind: "write" });
  });

  it("解码异常响应（FC01|0x80）", () => {
    const codec = new BasicTablesRtuCodec("coil");
    const frame = withCrc([0x01, 0x81, 0x02]);
    const result = codec.decodeResponse(frame, readExpect("coil", [0]));
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value).toEqual({ kind: "exception", exceptionCode: 0x02 });
  });

  it("CRC 损坏返回失败（供 parser 重同步）", () => {
    const codec = new BasicTablesRtuCodec("coil");
    const bad = Uint8Array.from([0x01, 0x01, 0x01, 0x8d, 0x00, 0x00]);
    const result = codec.decodeResponse(
      bad,
      readExpect("coil", [0, 1, 2, 3, 4, 5, 6, 7]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RTU_CRC_MISMATCH");
  });

  it("期望长度：读按表类型位打包/16 位，写固定 8", () => {
    const coil = new BasicTablesRtuCodec("coil");
    expect(
      coil.expectedLength(
        "read",
        readExpect("coil", [0, 1, 2, 3, 4, 5, 6, 7, 8]),
      ),
    ).toEqual({
      normal: 3 + 2 + 2,
      exception: 5,
    });
    const input = new BasicTablesRtuCodec("input-register");
    expect(
      input.expectedLength("read", readExpect("input-register", [0, 1])),
    ).toEqual({
      normal: 9,
      exception: 5,
    });
    expect(
      coil.expectedLength("write", writeExpect([{ address: 0, value: 1 }])),
    ).toEqual({
      normal: 8,
      exception: 5,
    });
  });
});

describe("BasicTablesRtuCodec 会话闭环（FakeTransport 回帧）", () => {
  async function connect(): Promise<{
    session: CommunicationSession;
    transport: FakeTransport;
    clock: ManualClock;
  }> {
    const transport = new FakeTransport();
    const clock = new ManualClock();
    const codecRegistry = createCodecRegistry();
    codecRegistry.register(new BasicTablesRtuCodec("coil"));
    const session = new CommunicationSession({
      transport,
      clock,
      config: createDefaultRtuProfile(),
      protocol: "modbus-basic-tables:coil",
      codecRegistry,
      slaveAddress: 1,
      onLog: () => undefined,
      onStateChange: () => undefined,
    });
    await session.connect();
    return { session, transport, clock };
  }

  it("coil 会话读（FC01）→ 位值回传", async () => {
    const { session, transport, clock } = await connect();
    const promise = session.readRegister(0, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(withCrc([0x01, 0x01, 0x01, 0x8d]));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);
    const sent = transport.sentFrames[0] ?? new Uint8Array(0);
    expect(Array.from(sent.slice(0, 6))).toEqual([
      0x01, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]);
  });

  it("coil 会话写（FC0F）→ 写回执", async () => {
    const { session, transport, clock } = await connect();
    const promise = session.writeRegister(0, 1, { source: "manual-write" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(withCrc([0x01, 0x0f, 0x00, 0x00, 0x00, 0x01]));
    const result = await promise;
    expect(result.ok).toBe(true);
    const sent = transport.sentFrames[0] ?? new Uint8Array(0);
    expect(Array.from(sent.slice(0, 7))).toEqual([
      0x01, 0x0f, 0x00, 0x00, 0x00, 0x01, 0x01,
    ]);
    expect(sent[7]).toBe(0x01);
  });

  it("coil 会话读异常（FC01|0x80）→ 设备异常错误", async () => {
    const { session, transport, clock } = await connect();
    const promise = session.readRegister(0, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(withCrc([0x01, 0x81, 0x02]));
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MODBUS_EXCEPTION_02");
  });

  it("coil 会话多读（FC01 9 位跨字节）", async () => {
    const { session, transport, clock } = await connect();
    const promise = session.readRegisters(0, 9, { source: "manual-read" });
    await advanceUntil(clock, () => transport.sentFrames.length === 1);
    transport.simulateData(withCrc([0x01, 0x01, 0x02, 0x01, 0x01]));
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 1]);
  });
});
