import { describe, expect, it } from "vitest";
import type { TcpExpectedResponse } from "@mamep2026/protocol-modbus";
import { TcpFrameParser } from "./tcp-frame-parser";

const expectRead: TcpExpectedResponse = {
  kind: "read-holding",
  transactionId: 0x1234,
  unitId: 1,
  startAddress: 0x0001,
  quantity: 1,
};

describe.each([
  { kind: "read-coils", fc: 1, pdu: [1, 1, 1] },
  { kind: "read-discrete-inputs", fc: 2, pdu: [2, 1, 1] },
  { kind: "read-input-registers", fc: 4, pdu: [4, 2, 0, 1] },
  { kind: "write-multiple-coils", fc: 15, pdu: [15, 0, 1, 0, 1] },
] as const)("TCP stream $kind", ({ kind, fc, pdu }) => {
  const expected: TcpExpectedResponse = {
    kind,
    transactionId: 0x1234,
    unitId: 1,
    startAddress: 1,
    address: 1,
    quantity: 1,
  };

  it("accepts every split point in normal and exception frames", () => {
    for (const payload of [pdu, [fc | 0x80, 2]]) {
      const frame = tcpFrame(0x1234, 1, Uint8Array.from(payload));
      for (let split = 1; split < frame.length; split++) {
        const parser = new TcpFrameParser(expected);
        expect(parser.push(frame.slice(0, split))).toEqual({ done: false });
        expect(parser.push(frame.slice(split))).toMatchObject({
          done: true,
          outcome: { ok: true },
        });
      }
    }
  });

  it("discards stale frames before a fragmented current frame", () => {
    const parser = new TcpFrameParser(expected);
    const current = tcpFrame(0x1234, 1, Uint8Array.from(pdu));
    expect(
      parser.push(
        concat(tcpFrame(0x1233, 1, Uint8Array.from(pdu)), current.slice(0, 8)),
      ),
    ).toEqual({ done: false });
    expect(parser.push(current.slice(8))).toMatchObject({
      done: true,
      outcome: { ok: true },
    });
  });

  it("resynchronizes after oversized MBAP lengths", () => {
    const parser = new TcpFrameParser(expected);
    expect(
      parser.push(
        concat(
          new Uint8Array(8).fill(0xaa),
          tcpFrame(0x1234, 1, Uint8Array.from(pdu)),
        ),
      ),
    ).toMatchObject({ done: true, outcome: { ok: true } });
  });
});

/** 组 MBAP 帧（tid/proto=0/length/unit + pdu），不含 CRC。 */
function tcpFrame(tid: number, unitId: number, pdu: Uint8Array): Uint8Array {
  const length = 1 + pdu.length;
  const frame = new Uint8Array(6 + length);
  frame[0] = (tid >> 8) & 0xff;
  frame[1] = tid & 0xff;
  frame[4] = (length >> 8) & 0xff;
  frame[5] = length & 0xff;
  frame[6] = unitId;
  frame.set(pdu, 7);
  return frame;
}

function readResponse(tid: number, unitId: number, value: number): Uint8Array {
  return tcpFrame(
    tid,
    unitId,
    Uint8Array.from([0x03, 0x02, (value >> 8) & 0xff, value & 0xff]),
  );
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

describe("TcpFrameParser 分帧与匹配", () => {
  it("一次完整帧即解析成功", () => {
    const parser = new TcpFrameParser(expectRead);
    const outcome = parser.push(readResponse(0x1234, 1, 0xabcd));
    expect(outcome.done).toBe(true);
    if (outcome.done) {
      expect(outcome.outcome.ok).toBe(true);
      if (outcome.outcome.ok) {
        expect(outcome.outcome.value).toEqual({
          kind: "read-holding",
          values: [0xabcd],
        });
      }
    }
  });

  it("半包：分片到达后组合成完整帧", () => {
    const frame = readResponse(0x1234, 1, 0x1234);
    const parser = new TcpFrameParser(expectRead);
    // 先推前 3 字节（MBAP 头都未凑齐）。
    expect(parser.push(frame.slice(0, 3)).done).toBe(false);
    // 再推剩余部分。
    const outcome = parser.push(frame.slice(3));
    expect(outcome.done).toBe(true);
  });

  it("粘包：单次 chunk 内多响应连续到达，先返回第一个，剩余留给下一次 push", () => {
    const first = readResponse(0x1234, 1, 0x0001);
    const second = readResponse(0x1234, 1, 0x0002);
    const parser = new TcpFrameParser(expectRead);
    const outcome = parser.push(concat(first, second));
    expect(outcome.done).toBe(true);
    if (outcome.done && outcome.outcome.ok) {
      expect(outcome.outcome.value).toEqual({
        kind: "read-holding",
        values: [0x0001],
      });
    }
    // 剩余帧在后续 push（空 chunk 也可触发）解析。
    const next = parser.push(new Uint8Array(0));
    expect(next.done).toBe(true);
    if (next.done && next.outcome.ok) {
      expect(next.outcome.value).toEqual({
        kind: "read-holding",
        values: [0x0002],
      });
    }
  });

  it("迟到响应 tid 不匹配：丢弃该帧，继续匹配当前请求的响应", () => {
    const late = readResponse(0x9999, 1, 0x7777);
    const current = readResponse(0x1234, 1, 0x0005);
    const parser = new TcpFrameParser(expectRead);
    const outcome = parser.push(concat(late, current));
    expect(outcome.done).toBe(true);
    if (outcome.done && outcome.outcome.ok) {
      expect(outcome.outcome.value).toEqual({
        kind: "read-holding",
        values: [0x0005],
      });
    }
  });

  it("unitId 不匹配的响应被丢弃", () => {
    const wrongUnit = readResponse(0x1234, 2, 0x7777);
    const current = readResponse(0x1234, 1, 0x0006);
    const parser = new TcpFrameParser(expectRead);
    const outcome = parser.push(concat(wrongUnit, current));
    expect(outcome.done).toBe(true);
    if (outcome.done && outcome.outcome.ok) {
      expect(outcome.outcome.value).toEqual({
        kind: "read-holding",
        values: [0x0006],
      });
    }
  });

  it("非法 Length（超上限）：丢弃首字节重新同步，最终解析出合法帧", () => {
    const frame = readResponse(0x1234, 1, 0x0007);
    // 8 个 0xAA 噪声（任意 7 字节窗口的 length 字段 = 0xAAAA > 254）。
    const noise = new Uint8Array(8).fill(0xaa);
    const parser = new TcpFrameParser(expectRead);
    const outcome = parser.push(concat(noise, frame));
    expect(outcome.done).toBe(true);
    if (outcome.done && outcome.outcome.ok) {
      expect(outcome.outcome.value).toEqual({
        kind: "read-holding",
        values: [0x0007],
      });
    }
  });

  it("异常响应：解析为 exception", () => {
    const parser = new TcpFrameParser(expectRead);
    const outcome = parser.push(
      tcpFrame(0x1234, 1, Uint8Array.from([0x83, 0x02])),
    );
    expect(outcome.done).toBe(true);
    if (outcome.done && outcome.outcome.ok) {
      expect(outcome.outcome.value).toEqual({
        kind: "exception",
        exceptionCode: 0x02,
      });
    }
  });

  it("数据不足时等待更多字节", () => {
    const parser = new TcpFrameParser(expectRead);
    const frame = readResponse(0x1234, 1, 0x0008);
    // 推完整头 + 部分 PDU（frameLength-1）。
    expect(parser.push(frame.slice(0, frame.length - 1)).done).toBe(false);
  });
});
